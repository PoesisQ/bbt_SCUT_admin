"""Download only explicitly selected school media; validate every HLS/redirect URL."""
from __future__ import annotations

import os
import subprocess
import wave
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
import m3u8


def validate_media_url(url: str, extra_hosts=()) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    trusted = host == "scut.edu.cn" or host.endswith(".scut.edu.cn") or host in extra_hosts
    if (parsed.scheme not in {"http", "https"} or not trusted or parsed.username or parsed.password or
            parsed.port not in {None, 80, 443} or parsed.fragment):
        raise ValueError("视频源不在学校域名允许列表中；请核对来源后在设置中添加准确的媒体主机名")
    return url


class Downloader:
    def __init__(self, settings, cancelled=lambda: False, progress=lambda text: None):
        self.settings = settings
        self.cancelled = cancelled
        self.progress = progress
        self.bytes = 0

    def download(self, url: str, dest: Path, *, limit=4 * 1024**3) -> str:
        if self.cancelled():
            raise ValueError("任务已取消")
        with httpx.Client(timeout=45, follow_redirects=False, trust_env=False) as client:
            for _ in range(6):
                validate_media_url(url, self.settings.data["media_hosts"])
                with client.stream("GET", url, headers={"User-Agent": "SCUT-Local-Assistant/0.3"}) as response:
                    if response.is_redirect:
                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    if response.status_code != 200:
                        raise ValueError(f"视频源 HTTP {response.status_code}；请在课程页刷新源地址，或使用标签页实时字幕")
                    with dest.open("wb") as out:
                        for chunk in response.iter_bytes(256 * 1024):
                            if self.cancelled():
                                raise ValueError("任务已取消")
                            self.bytes += len(chunk)
                            if self.bytes > limit:
                                raise ValueError("单课媒体超过 4GB 上限，请使用本地文件或较低清晰度源")
                            out.write(chunk)
                    return url
        raise ValueError("媒体源重定向过多")

    def fetch(self, url: str, folder: Path) -> Path:
        path = folder / "source.media"
        final = self.download(url, path)
        with path.open("rb") as handle:
            prefix = handle.read(16)
        if not prefix.lstrip().startswith(b"#EXTM3U"):
            return path
        for depth in range(4):
            if path.stat().st_size > 4 * 1024**2:
                raise ValueError("HLS 清单过大")
            playlist = m3u8.loads(path.read_text(encoding="utf-8-sig"), uri=final)
            if playlist.is_variant:
                candidates = [p for p in playlist.playlists if not p.stream_info.audio]
                if not candidates:
                    raise ValueError("此 HLS 使用独立音轨，请使用标签页捕获")
                selected = min(candidates, key=lambda p: p.stream_info.bandwidth or 10**12)
                final = self.download(urljoin(final, selected.uri), path)
                continue
            if not playlist.is_endlist:
                raise ValueError("这是持续更新的直播清单，请使用实时字幕录制；批处理仅接受已结束的回放")
            if not playlist.segments or len(playlist.segments) > 15000:
                raise ValueError("HLS 分片数量异常")
            if any(k and k.method != "NONE" for k in playlist.keys):
                raise ValueError("此回放使用加密 HLS，请在正常播放时使用标签页实时字幕")
            local_lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{playlist.target_duration or 60}"]
            maps = {}
            for index, segment in enumerate(playlist.segments):
                if segment.byterange:
                    raise ValueError("此 HLS 使用字节范围分片，请使用标签页捕获")
                if segment.init_section:
                    init = segment.init_section
                    if init.byterange:
                        raise ValueError("此 HLS 初始化段使用字节范围，请使用标签页捕获")
                    absolute = urljoin(final, init.uri)
                    if absolute not in maps:
                        name = f"init-{len(maps)}.bin"
                        self.download(absolute, folder / name)
                        maps[absolute] = name
                    local_lines.append(f'#EXT-X-MAP:URI="{maps[absolute]}"')
                name = f"segment-{index:06d}.bin"
                self.download(urljoin(final, segment.uri), folder / name)
                if segment.discontinuity:
                    local_lines.append("#EXT-X-DISCONTINUITY")
                local_lines += [f"#EXTINF:{segment.duration},", name]
                if index % 30 == 0:
                    self.progress(f"下载回放分片 {index + 1}/{len(playlist.segments)}")
            local_lines.append("#EXT-X-ENDLIST")
            local = folder / "local.m3u8"
            local.write_text("\n".join(local_lines), encoding="utf-8")
            return local
        raise ValueError("HLS 清单嵌套过深")


def decode(settings, source: Path, target: Path, cancelled=lambda: False):
    ffmpeg = Path(settings.data["ffmpeg_path"])
    if not ffmpeg.is_file():
        raise ValueError("FFmpeg 不存在，请检查本地引擎设置")
    # Network has already been handled by the validating downloader. Decoder cannot fetch URLs.
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-protocol_whitelist", "file,crypto",
               "-format_whitelist", "mov,matroska,webm,mp3,wav,flac,ogg,aac,mpegts,flv,hls,aiff"]
    if source.suffix == ".m3u8":
        command += ["-allowed_extensions", "ALL"]
    command += ["-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", "-t", "21601", str(target)]
    with (target.parent / "decode.log").open("wb") as log:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=log,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            while True:
                try:
                    code = process.wait(timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    if cancelled():
                        raise ValueError("任务已取消")
            if code:
                raise ValueError("无法提取音轨，请确认源含有声音；详情保存在本地 decode.log")
            with wave.open(str(target), "rb") as audio:
                if audio.getnframes() / audio.getframerate() > 21600:
                    raise ValueError("音轨超过六小时，未将截断结果作为完整课时处理")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


def split_wav(source: Path, directory: Path):
    with wave.open(str(source), "rb") as audio:
        total = audio.getnframes()
        rate = audio.getframerate()
        stride, window = 58 * rate, 60 * rate
        for index, position in enumerate(range(0, total, stride)):
            audio.setpos(position)
            path = directory / f"replay-{index:06d}.wav"
            with wave.open(str(path), "wb") as out:
                out.setparams(audio.getparams())
                out.writeframes(audio.readframes(window))
            yield path, position / rate, min(window, total - position) / rate
