#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, os, shutil, subprocess
from pathlib import Path
START = "<!-- hermes-live-voice:start -->"; END = "<!-- hermes-live-voice:end -->"
def desktop_shim(home: Path) -> Path:
    return home / "desktop-plugins" / "hermes-live-voice"
def managed_desktop_shim(path: Path, root: Path) -> bool:
    plugin = path / "plugin.js"
    return path.is_dir() and not path.is_symlink() and list(path.iterdir()) == [plugin] and plugin.is_symlink() and plugin.resolve() == (root / "desktop/plugin.js").resolve()
def remove_desktop_shim(home: Path, root: Path, dry: bool) -> None:
    path = desktop_shim(home)
    if not path.exists() and not path.is_symlink(): return
    if not managed_desktop_shim(path, root):
        print(f"preserve unrelated desktop shim content at {path}")
        return
    print(f"remove managed desktop shim {path}")
    if not dry: (path / "plugin.js").unlink(); path.rmdir()
def run(cmd: list[str], dry: bool) -> None:
    print("$", " ".join(cmd))
    if not dry: subprocess.run(cmd, check=False)
def main() -> int:
    p = argparse.ArgumentParser(); p.add_argument("--dry-run", action="store_true"); args = p.parse_args()
    home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")); target = home / "plugins" / "hermes-live-voice"; soul = home / "SOUL.md"
    root = Path(__file__).resolve().parents[1]
    run(["hermes", "plugins", "disable", "hermes-live-voice"], args.dry_run)
    print(f"remove {target}")
    if not args.dry_run and (target.exists() or target.is_symlink()): target.unlink() if target.is_symlink() else shutil.rmtree(target)
    remove_desktop_shim(home, root, args.dry_run)
    if soul.exists():
        text = soul.read_text(encoding="utf-8"); start = text.find(START); end = text.find(END)
        if start >= 0 and end >= start:
            stamp = dt.datetime.now().astimezone().strftime("%Y%m%d-%H%M%S"); backup = soul.with_name(f"{soul.name}.backup-{stamp}")
            print(f"backup {soul} -> {backup}")
            if not args.dry_run: shutil.copy2(soul, backup)
            print(f"remove marked protocol from {soul}")
            if not args.dry_run: soul.write_text((text[:start] + text[end + len(END):]).strip() + "\n", encoding="utf-8")
    return 0
if __name__ == "__main__": raise SystemExit(main())
