"""Build both downloads into dist/: the Claude Desktop extension and the Claude-on-the-web zip.

    python scripts/build_dist.py
"""

import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
WEB_FILES = [
    "Start Rough Cut Web.command", "Start Rough Cut Web.bat", "README.md", "pyproject.toml", "uv.lock",
    ".python-version", "main.py",
]


def web_zip() -> Path:
    out = DIST / "Rough Cut Web.zip"
    files = [ROOT / name for name in WEB_FILES]
    files += sorted(p for p in (ROOT / "src").rglob("*.py"))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in files:
            info = zipfile.ZipInfo(f"Rough Cut Web/{path.relative_to(ROOT).as_posix()}", (2026, 1, 1, 0, 0, 0))
            executable = path.suffix == ".command"
            info.external_attr = ((0o100755 if executable else 0o100644) << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, path.read_bytes())
    return out


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    subprocess.run(["npx", "-y", "@anthropic-ai/mcpb@latest", "pack", str(ROOT), str(DIST / "roughcut.mcpb")],
                   check=True)
    print(f"Wrote {web_zip()}")
