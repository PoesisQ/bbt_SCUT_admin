"""Prepare and check the SCUT connector without changing WorkBuddy trust settings."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from contextlib import closing
from pathlib import Path

from .settings import ROOT

CONNECTOR = "scut-study"
WORKBUDDY_HOME = Path.home() / ".workbuddy"


def workbuddy_executable():
    """Resolve the official Start menu shortcut, including non-default drives."""
    if os.name != "nt":
        return None
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    command = (
        "$shell = New-Object -ComObject WScript.Shell;"
        "foreach ($scope in 'Programs','CommonPrograms') {"
        "  $folder = [Environment]::GetFolderPath($scope);"
        "  if (!$folder) { continue };"
        "  foreach ($name in 'WorkBuddy.lnk','WorkBuddy\\WorkBuddy.lnk') {"
        "    $file = Join-Path $folder $name;"
        "    if (Test-Path -LiteralPath $file) {"
        "      $target = $shell.CreateShortcut($file).TargetPath;"
        "      if ($target -and (Test-Path -LiteralPath $target -PathType Leaf)) {"
        "        [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::WriteLine($target); exit"
        "      }"
        "    }"
        "  }"
        "}"
    )
    try:
        result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", command],
                                capture_output=True, encoding="utf-8-sig", timeout=5,
                                creationflags=subprocess.CREATE_NO_WINDOW, check=True)
        target = Path(result.stdout.strip())
        if target.is_absolute() and target.name.casefold() == "workbuddy.exe" and target.is_file():
            return target.resolve()
    except (OSError, subprocess.SubprocessError, UnicodeError):
        pass
    return None


def connector_config(home):
    path = home / "mcp.json"
    if not path.exists():
        return {}
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or not isinstance(config.get("mcpServers", {}), dict):
        raise ValueError("WorkBuddy MCP 配置格式无效")
    return config


def owned_connector(entry):
    if not isinstance(entry, dict) or not isinstance(entry.get("args"), list):
        return False
    return any(isinstance(arg, str) and arg.replace("\\", "/").endswith("/scripts/study_mcp.py")
               for arg in entry["args"])


def skill_resources(root):
    return [root / "SKILL.md", *sorted((root / "references").rglob("*.md"))]


def install_local(config, output, target, *, skill_root=None):
    """Merge one named server and our skill, with local backups. No trust bypass."""
    resource_root = Path(skill_root or ROOT / "workbuddy/skills/scut-study").resolve()
    source = resource_root / "SKILL.md"
    text = source.read_text(encoding="utf-8")
    resources = skill_resources(resource_root)
    for item in resources:
        if item.is_symlink() or not item.resolve().is_relative_to(resource_root) or item.stat().st_size > 1000000:
            raise ValueError("技能资源超出范围或大小限制，未安装")
    for name in re.findall(r"references/[A-Za-z0-9_./-]+\.md", text):
        path = resource_root / name
        if not path.resolve().is_relative_to(resource_root) or not path.is_file():
            raise ValueError("技能引用的规程不存在，未修改配置：" + name)
    target = Path(target).expanduser().resolve()
    for item in resources:
        destination = target / "skills/scut-study" / item.relative_to(resource_root)
        if destination.is_symlink() or not destination.resolve().is_relative_to(target):
            raise ValueError("技能目标路径异常，未修改配置")
    path = target / "mcp.json"
    previous = path.read_bytes() if path.exists() else None
    current = json.loads(previous.decode("utf-8-sig")) if previous else {}
    if not isinstance(current, dict) or not isinstance(current.get("mcpServers", {}), dict):
        raise ValueError("WorkBuddy MCP 配置结构异常，未修改原文件")
    servers = current.setdefault("mcpServers", {})
    server = config["mcpServers"]["scut-study"]
    existing = servers.get("scut-study")
    if "scut-study" in servers and not owned_connector(existing):
        raise ValueError("已有同名但不同的连接器，请先在 WorkBuddy 中检查；未覆盖")
    backups = output / "backups" / str(time.time_ns())
    changed = existing != server
    if changed:
        if previous:
            backups.mkdir(parents=True, exist_ok=True); (backups / "mcp.json").write_bytes(previous)
        servers["scut-study"] = server
        target.mkdir(parents=True, exist_ok=True)
        # Compare before replace; a concurrently edited config must not be overwritten.
        if (path.read_bytes() if path.exists() else None) != previous:
            raise ValueError("WorkBuddy 配置刚刚发生变化，请重试；未覆盖")
        temp = target / ("mcp.scut-" + str(time.time_ns()) + ".tmp")
        temp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    skill = target / "skills/scut-study/SKILL.md"
    copied = []
    for item in resources:
        relative = item.relative_to(resource_root)
        destination = skill.parent / relative
        data = item.read_bytes()
        previous_data = destination.read_bytes() if destination.exists() else None
        if previous_data == data: continue
        if destination.is_symlink() or not destination.resolve().is_relative_to(target):
            raise ValueError("技能目标路径异常，未覆盖")
        if previous_data is not None:
            backup = backups / "skill" / relative
            backup.parent.mkdir(parents=True, exist_ok=True); backup.write_bytes(previous_data)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp = destination.with_name(destination.name + ".scut-" + str(time.time_ns()) + ".tmp")
        temp.write_bytes(data)
        if (destination.read_bytes() if destination.exists() else None) != previous_data:
            temp.unlink()
            raise ValueError("技能文件刚被修改，请重试；未覆盖")
        os.replace(temp, destination)
        copied.append(relative.as_posix())
    return {"config": str(path), "skill": str(skill), "changed": changed, "skill_files_changed": copied,
        "notice": "在 WorkBuddy 自定义连接器检查 scut-study。重连仍失败时，在客户端的 MCP JSON 编辑器核对路径并保存。"}


def configuration(data_dir, python=None, root=ROOT):
    data_dir = Path(data_dir).resolve()
    if not (data_dir / "study-agent.sqlite3").is_file():
        raise ValueError("先在学习助手中导入课程资料，再选择该资料库目录。")
    # Resolving a Unix venv symlink launches the base interpreter without its deps.
    return {"mcpServers": {"scut-study": {"type": "stdio", "command": str(Path(python or sys.executable).absolute()),
        "args": [str(root / "scripts/study_mcp.py"), "--data-dir", str(data_dir)], "timeout": 30000}}}


def workbuddy_status(data_dir, *, home=WORKBUDDY_HOME, root=ROOT, python=None):
    from .study_agent.tutoring import VERSION

    result = {"installed": workbuddy_executable() is not None, "expected_version": VERSION,
              "state": "setup_needed", "has_sources": False}
    data_dir = Path(data_dir).resolve()
    index = data_dir / "study-agent.sqlite3"
    try:
        config = connector_config(Path(home)).get("mcpServers", {})
        entry = config.get(CONNECTOR)
    except (OSError, ValueError):
        return {**result, "state": "invalid_config"}
    if CONNECTOR in config and not owned_connector(entry):
        return {**result, "state": "connector_conflict"}
    if index.is_file():
        try:
            with closing(sqlite3.connect(index.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
                result["has_sources"] = db.execute("SELECT 1 FROM sources WHERE active=1 LIMIT 1").fetchone() is not None
        except sqlite3.Error:
            return {**result, "state": "index_error"}
    if entry:
        if not index.is_file() or entry != configuration(data_dir, python, root)["mcpServers"][CONNECTOR]:
            return {**result, "state": "paths_changed"}
        skill = Path(home) / "skills/scut-study"
        source = root / "workbuddy/skills/scut-study"
        try:
            if any((skill / item.relative_to(source)).read_bytes() != item.read_bytes() for item in skill_resources(source)):
                return {**result, "state": "skill_changed"}
        except OSError:
            return {**result, "state": "skill_changed"}
        result["state"] = "configured"
    return result


def probe_connector(data_dir, *, root=ROOT, python=None):
    """Launch the project's own fixed command, never the user's arbitrary MCP entries."""
    from .study_agent.tutoring import VERSION

    server = configuration(data_dir, python, root)["mcpServers"][CONNECTOR]
    messages = [
        {"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
        {"method": "notifications/initialized"},
        {"id": 2, "method": "tools/list"},
        {"id": 3, "method": "tools/call", "params": {"name": "study_connection_status"}},
    ]
    try:
        reply = subprocess.run([server["command"], *server["args"]], capture_output=True, encoding="utf-8",
                               input="".join(json.dumps({"jsonrpc": "2.0", **m}) + "\n" for m in messages),
                               timeout=15, check=True,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        responses = {m["id"]: m for line in reply.stdout.splitlines() if (m := json.loads(line))}
        server_info = responses[1]["result"]["serverInfo"]
        tools = responses[2]["result"]["tools"]
        status = json.loads(responses[3]["result"]["content"][0]["text"])
        if (not status["connected"] or status["server_version"] != VERSION or server_info["version"] != VERSION
                or len(tools) != status["tools"]):
            raise ValueError("MCP version mismatch")
    except (KeyError, ValueError, TypeError, IndexError, OSError, subprocess.SubprocessError):
        return {"ok": False, "message": "本地连接器启动失败。请重新安装学习助手，或检查所用的 Python 和资料目录。"}
    return {"ok": True, "version": status["server_version"], "tools": status["tools"], "courses": status["courses"]}


def prepare_desktop(data_dir, *, home=WORKBUDDY_HOME, root=ROOT, python=None, repair=False):
    from .study_agent.storage import StudyStore

    data_dir = Path(data_dir).resolve()
    state = workbuddy_status(data_dir, home=home, root=root, python=python)
    if not state["installed"]:
        return state
    if state["state"] in {"invalid_config", "connector_conflict", "index_error"}:
        return state
    if state["state"] == "paths_changed" and not repair:
        return state
    StudyStore(data_dir)
    probe = probe_connector(data_dir, root=root, python=python)
    if not probe["ok"]:
        return {**state, "state": "runtime_error", "probe": probe}
    installed = install_local(configuration(data_dir, python, root), data_dir / "workbuddy", home,
                              skill_root=root / "workbuddy/skills/scut-study")
    return {**state, "state": "configured", "probe": probe, "has_sources": probe["courses"] > 0,
            "config_changed": installed["changed"]}


def launch_workbuddy():
    target = workbuddy_executable()
    if not target:
        raise ValueError("没有在 Windows 开始菜单找到 WorkBuddy。安装后再打开。")
    subprocess.Popen([str(target)], cwd=target.parent)
