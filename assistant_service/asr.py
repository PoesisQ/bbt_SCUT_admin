from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import wave
from pathlib import Path


def repetitive_text(text: str) -> bool:
    """Only flag extreme loops; natural stutters and short repeated phrases remain intact."""
    if "\ufffd" in text:
        return True
    return any(len(m.group()) >= 24 for m in re.finditer(r"(.{1,24}?)\1{7,}", text[:8000]))


def repetitive_segments(segments: list[dict]) -> bool:
    if any(repetitive_text(s["text"]) for s in segments):
        return True
    # Whisper can split a token loop into individually plausible sentences.
    # Require impossible phrase durations as well as an extreme joined loop,
    # so a teacher deliberately repeating a sentence is not discarded.
    tiny_phrases = sum(len(re.sub(r"\W", "", s["text"])) >= 4
                       and float(s["end"]) - float(s["start"]) <= 0.08 for s in segments)
    joined = "".join(re.sub(r"\W", "", s["text"]) for s in segments)
    return tiny_phrases >= 2 and repetitive_text(joined)


class Transcriber:
    def __init__(self, settings):
        self.settings = settings
        self.model = None
        self.signature = None
        self.lock = threading.RLock()
        self.dll_handles = []
        self.loaded_device = None

    def diagnostics(self):
        data = self.settings.data
        return {"engine": data["engine"], "model_exists": (Path(data["model_path"]) / "model.bin").is_file(),
                "exe_exists": Path(data["engine_path"]).is_file(), "ffmpeg_exists": Path(data["ffmpeg_path"]).is_file(),
                "loaded": self.model is not None, "device": self.loaded_device or data["device"]}

    def load(self):
        data = self.settings.data
        signature = tuple(data[k] for k in ("model_path", "device", "compute_type"))
        if self.model is not None and signature == self.signature:
            return
        model_path = Path(data["model_path"])
        if not (model_path / "model.bin").is_file():
            raise ValueError("未找到本地模型 model.bin，请检查设置中的模型目录；不会自动下载模型")
        if os.name == "nt":
            engine = Path(data["engine_path"]).parent
            # Read-only reuse of the installed PotPlayer CUDA runtime. No global PATH changes.
            for path in (engine / "_xxl_data" / "torch" / "lib",):
                if path.is_dir():
                    self.dll_handles.append(os.add_dll_directory(str(path)))
                    os.environ["PATH"] = str(path) + os.pathsep + os.environ.get("PATH", "")
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise ValueError("请运行 uv sync --extra asr 安装常驻识别依赖，或选择 XXL 引擎") from exc
        self.model = None
        self.model = WhisperModel(str(model_path), device=data["device"], compute_type=data["compute_type"],
                                  local_files_only=True, cpu_threads=6, num_workers=1)
        self.signature = signature
        self.loaded_device = data["device"]

    def transcribe(self, path: Path) -> list[dict]:
        with self.lock:
            data = self.settings.data.copy()
            if data["engine"] == "xxl":
                return self.xxl(path, data)
            self.load()
            options = dict(
                language=None if data["language"] == "auto" else data["language"],
                beam_size=5, vad_filter=True, vad_parameters={"min_silence_duration_ms": 450},
                # CT2 4.4's Windows CUDA sampler can crash when freeing curand states.
                # Deterministic beam search avoids that sampler (including fallback temperatures).
                temperature=0.0,
                condition_on_previous_text=False, initial_prompt=data["hotwords"] or None,
                word_timestamps=False,
            )
            def decode(extra=None):
                generated, info = self.model.transcribe(str(path), **(options | (extra or {})))
                return [{"start": float(s.start), "end": float(s.end), "text": s.text.strip(),
                         "language": info.language, "language_probability": round(info.language_probability, 4),
                         "avg_logprob": round(s.avg_logprob, 4)}
                        for s in generated if s.text.strip() and s.no_speech_prob < 0.85]

            first = decode()
            if not repetitive_segments(first):
                return first
            attempts = [first]
            # A fixed language can force English audio into Chinese token loops. Detect
            # the language again before introducing any repetition penalty.
            retries = [{"language": None}] if options["language"] is not None else []
            retries.append({"language": None, "repetition_penalty": 1.15, "no_repeat_ngram_size": 4})
            selected = None
            for retry in retries:
                candidate = decode(retry)
                attempts.append(candidate)
                # A repetition penalty can force fluent but unrelated words. After a
                # pathological decode, an ambiguous language is still a review case.
                if candidate and not repetitive_segments(candidate) and all(s["language_probability"] >= 0.8 for s in candidate):
                    selected = [s | {"quality": "retried"} for s in candidate]
                    break
            if selected is None:
                selected = [{"start": min(s["start"] for s in first), "end": max(s["end"] for s in first),
                             "text": "〔此段识别不可靠，已保留音频待复核〕", "quality": "uncertain"}]
            path.with_suffix(".asr.json").write_text(json.dumps({"audio": path.name, "reason": "extreme_repetition",
                "attempts": attempts, "selected": selected}, ensure_ascii=False, indent=2), encoding="utf-8")
            return selected

    def xxl(self, path, data):
        executable = Path(data["engine_path"])
        if not executable.is_file():
            raise ValueError("Faster-Whisper-XXL 可执行文件不存在")
        output = path.parent / (path.stem + "-xxl")
        output.mkdir(exist_ok=True)
        command = [str(executable), str(path), "--model", data["model_path"], "--model_dir", data["model_path"],
                   "--output_dir", str(output), "--device", data["device"], "--compute_type", data["compute_type"],
                   "--beam_size", "3", "--beep_off", "--print_progress", "--output_format", "json"]
        if data["language"] != "auto":
            command += ["--language", data["language"]]
        if data["hotwords"]:
            command += ["--initial_prompt", data["hotwords"]]
        result = subprocess.run(command, cwd=self.settings.root, capture_output=True, timeout=900,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode:
            raise ValueError("XXL 识别失败；请检查模型、CUDA 与显存，或切换 CPU 模式")
        files = list(output.glob("*.json"))
        if not files:
            raise ValueError("XXL 未生成 JSON 字幕")
        body = json.loads(files[0].read_text(encoding="utf-8-sig"))
        return [{"start": float(x["start"]), "end": float(x["end"]), "text": x["text"].strip()}
                for x in body.get("segments", []) if x.get("text", "").strip()]


def validate_wav(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError("音频必须是 16kHz / 单声道 / PCM16 WAV")
            if not 0 < duration <= 120:
                raise ValueError("每段音频须为 0–120 秒")
            if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
                raise ValueError("音频数据不完整")
            return duration
    except (wave.Error, EOFError) as exc:
        raise ValueError("无法解析 WAV 音频") from exc
