#!/usr/bin/env python3
"""Install hermes-live-voice without reading or exposing secrets."""
from __future__ import annotations
import argparse, datetime as dt, os, shutil, subprocess
from pathlib import Path

NAME = "hermes-live-voice"
START = "<!-- hermes-live-voice:start -->"; END = "<!-- hermes-live-voice:end -->"
PROTOCOL = f"""{START}
## Hermes Live Voice protocol
모든 답변은 글로는 그대로 완성하고 마지막에 말할 내용만 담은 정확히 하나의 닫힌 `<<<VOICE ... VOICE>>>` 블록으로 끝낸다. 블록은 한국어로 자연스럽게, 지호라는 호칭은 자연스러울 때만 사용하고, 보통 5개 이하의 짧은 문장으로 결과와 다음 행동을 말한다.
블록에는 목록·코드·로그·경로·회고를 넣지 않으며, 행동이나 결정이 필요하면 짧은 질문 하나만 하고 선택지는 최대 세 개(`A/B/C`)까지 제시한 뒤 기다린다. 닫히지 않은 블록이나 블록이 없는 답변은 말하지 않는다.
음성 명령은 수동 Start, 웨이크 문구, 또는 `헤이 헤르메스`로 시작할 때만 받으며 방 소음과 TTS 메아리는 무시한다. 답변 뒤에는 `진행해 헤르메스`/`진행해` 또는 마지막 음성 질문과 맞는 A/B/C 중 하나만 이어서 받는다.
{END}"""

def run(cmd: list[str], dry: bool) -> None:
    print("$", " ".join(cmd))
    if not dry: subprocess.run(cmd, check=True)

def copy_ignore(_directory: str, names: list[str]) -> set[str]:
    excluded = {'.git', '.omx', 'tests', 'node_modules', '__pycache__', '.pytest_cache', '.next', 'dist', 'build', 'coverage', '.cache'}
    return {name for name in names if name in excluded or name.endswith(('.tsbuildinfo', '.log'))}

def desktop_shim(home: Path) -> Path:
    return home / "desktop-plugins" / NAME

def managed_desktop_shim(path: Path, root: Path) -> bool:
    plugin = path / "plugin.js"
    return path.is_dir() and not path.is_symlink() and list(path.iterdir()) == [plugin] and plugin.is_symlink() and plugin.resolve() == (root / "desktop/plugin.js").resolve()

def ensure_desktop_shim(home: Path, root: Path, dry: bool) -> None:
    path = desktop_shim(home); plugin = path / "plugin.js"; target = root / "desktop/plugin.js"
    if path.exists() or path.is_symlink():
        if managed_desktop_shim(path, root):
            print(f"desktop shim already managed: {path}")
            return
        if not dry: raise SystemExit(f"refusing to replace unrelated desktop shim content at {path}")
        print(f"would refuse to replace unrelated desktop shim content at {path}")
        return
    print(f"create desktop shim directory {path}")
    print(f"symlink {plugin} -> {target}")
    if not dry:
        path.parent.mkdir(parents=True, exist_ok=True); path.mkdir(); plugin.symlink_to(target)

def backup(path: Path, stamp: str, dry: bool) -> None:
    if path.exists():
        target = path.with_name(f"{path.name}.backup-{stamp}")
        print(f"backup {path} -> {target}")
        if not dry: shutil.copy2(path, target)

def merge_soul(path: Path, dry: bool) -> None:
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    start = old.find(START); end = old.find(END)
    new = old[:start] + PROTOCOL + old[end + len(END):] if start >= 0 and end >= start else old.rstrip() + ("\n\n" if old.strip() else "") + PROTOCOL + "\n"
    print(f"merge marked protocol into {path}")
    if not dry: path.write_text(new, encoding="utf-8")

def maybe_merge_soul(path: Path, dry: bool, skip: bool) -> None:
    if skip:
        print("skip SOUL merge (--skip-soul); backup still completed")
    else:
        merge_soul(path, dry)

def main() -> int:
    p = argparse.ArgumentParser(); p.add_argument("--dry-run", action="store_true"); p.add_argument("--link", action="store_true"); p.add_argument("--skip-soul", action="store_true", help="backup SOUL.md but do not merge the managed protocol block")
    args = p.parse_args(); root = Path(__file__).resolve().parents[1]
    home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")); target = home / "plugins" / NAME
    stamp = dt.datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
    backup(home / "config.yaml", stamp, args.dry_run); backup(home / "SOUL.md", stamp, args.dry_run)
    if args.dry_run: print("$ node", root / "scripts/build.js")
    else: run(["node", str(root / "scripts/build.js")], False)
    if target.exists() or target.is_symlink():
        if not args.dry_run: raise SystemExit(f"refusing to replace existing {target}; uninstall it first")
        print(f"would refuse to replace existing {target}; uninstall it first")
    print(f"install {root} -> {target} ({'link' if args.link else 'copy'})")
    if not args.dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        if args.link: target.symlink_to(root, target_is_directory=True)
        else: shutil.copytree(root, target, ignore=copy_ignore)
    if args.link: ensure_desktop_shim(home, root, args.dry_run)
    maybe_merge_soul(home / "SOUL.md", args.dry_run, args.skip_soul)
    run(["hermes", "config", "set", "voice.auto_tts", "false"], args.dry_run)
    run(["hermes", "config", "set", "voice.barge_in", "true"], args.dry_run)
    run(["hermes", "config", "set", "stt.enabled", "true"], args.dry_run)
    run(["hermes", "plugins", "doctor", "--ci", str(target)], args.dry_run)
    run(["hermes", "plugins", "enable", NAME], args.dry_run)
    print("installed and enabled; reload desktop plugins from the Hermes command palette")
    return 0
if __name__ == "__main__": raise SystemExit(main())
