"""Build the public WorkBuddy expert team package from project-owned sources."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
TEAM = ROOT / "workbuddy" / "expert-team"


def build(output: Path):
    manifest = json.loads((TEAM / ".codebuddy-plugin/plugin.json").read_text(encoding="utf-8"))
    members = [manifest["teamInfo"]["leadAgent"], *manifest["teamInfo"]["memberAgents"]]
    agent_paths = [f"agents/{member}.md" for member in members]
    if (manifest["agents"] != ["./" + path for path in agent_paths]
            or [member["id"] for member in manifest["members"]] != members):
        raise ValueError("专家团成员、角色文件与清单不一致")
    files = [".codebuddy-plugin/plugin.json", "settings.json", "README.md", *agent_paths]
    files = {path: (TEAM / path).read_bytes() for path in files}
    files["avatars/team.png"] = (ROOT / "extension/icons/assistant-512.png").read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for path, contents in files.items():
            archive.writestr(manifest["name"] + "/" + path, contents)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / "scut-learning-team.zip")
    args = parser.parse_args()
    build(args.output)
    print(args.output.resolve())
