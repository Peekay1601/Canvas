"""Web mode: serve the rough-cut tools to Claude on the web (claude.ai) as a custom connector.

claude.ai reaches connectors over public HTTPS, but the footage lives on this computer. So the server runs here,
bound to localhost, and a Cloudflare tunnel gives it a public address. The connector URL carries a long random
token (the only way in), and the tools can only open the folders shared at startup.
"""

from __future__ import annotations

import argparse
import io
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import threading
import urllib.request
from pathlib import Path

from . import server

TOKEN_FILE = Path.home() / ".roughcut" / "web-token"
_TUNNEL_URL = re.compile(r"https://[-a-z0-9]+\.trycloudflare\.com")


def _token(reset: bool) -> str:
    """Kept between runs so a stable tunnel address gives a stable connector URL."""
    if TOKEN_FILE.exists() and not reset:
        token = TOKEN_FILE.read_text().strip()
        if len(token) >= 32:
            return token
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(token)
    try:
        TOKEN_FILE.chmod(0o600)
    except OSError:
        pass
    return token


_RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download/"


def _cloudflared() -> str | None:
    """cloudflared from PATH, else Cloudflare's official release fetched once into ~/.roughcut/bin."""
    found = shutil.which("cloudflared")
    if found:
        return found
    machine = platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    if sys.platform == "darwin":
        asset, exe_name = f"cloudflared-darwin-{'arm64' if arm else 'amd64'}.tgz", "cloudflared"
    elif sys.platform == "win32":
        asset, exe_name = "cloudflared-windows-amd64.exe", "cloudflared.exe"
    else:
        asset, exe_name = f"cloudflared-linux-{'arm64' if arm else 'amd64'}", "cloudflared"
    target = Path.home() / ".roughcut" / "bin" / exe_name
    if target.exists():
        return str(target)
    print(f"Downloading cloudflared from Cloudflare ({asset})…", flush=True)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(_RELEASES + asset, timeout=120) as resp:
            data = resp.read()
        if asset.endswith(".tgz"):
            with tarfile.open(fileobj=io.BytesIO(data)) as tar:
                member = next(m for m in tar.getmembers() if Path(m.name).name == "cloudflared")
                data = tar.extractfile(member).read()
        target.write_bytes(data)
        target.chmod(0o755)
    except Exception as exc:
        print(f"Couldn't download cloudflared ({exc}).", flush=True)
        return None
    return str(target)


def _start_tunnel(port: int) -> tuple[subprocess.Popen | None, str | None]:
    """A Cloudflare quick tunnel (no account needed). Its address changes every run."""
    exe = _cloudflared()
    if exe is None:
        return None, None
    proc = subprocess.Popen(
        [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    found: list[str] = []
    ready = threading.Event()

    def read() -> None:
        for line in proc.stdout:  # keep draining so cloudflared never blocks on a full pipe
            match = _TUNNEL_URL.search(line)
            if match and not found:
                found.append(match.group(0))
                ready.set()
        ready.set()

    threading.Thread(target=read, daemon=True).start()
    ready.wait(timeout=45)
    return proc, (found[0] if found else None)


def _banner(lines: list[str]) -> None:
    width = max(len(line) for line in lines) + 4
    print("\n" + "=" * width, flush=True)
    for line in lines:
        print(f"  {line}", flush=True)
    print("=" * width + "\n", flush=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="roughcut-mcp web", description="Serve Rough Cut to Claude on the web as a custom connector."
    )
    parser.add_argument("--folder", action="append", required=True,
                        help="Footage folder Claude may open (repeat for more). Nothing outside these is reachable.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-tunnel", action="store_true",
                        help="Don't start a Cloudflare tunnel (use your own, e.g. ngrok or Tailscale Funnel).")
    parser.add_argument("--public-url", default="",
                        help="Your own tunnel's https address, to print the right connector URL.")
    parser.add_argument("--new-token", action="store_true",
                        help="Make a new secret (the old connector URL stops working).")
    args = parser.parse_args(argv)

    folders = [Path(f).expanduser().resolve() for f in args.folder]
    missing = [str(f) for f in folders if not f.is_dir()]
    if missing:
        sys.exit(f"Not a folder: {', '.join(missing)}")
    server.share_only(folders)

    token = _token(args.new_token)
    path = f"/{token}/mcp"

    import uvicorn
    from mcp.server.transport_security import TransportSecuritySettings

    # The secret path is the lock. Host checks would reject the tunnel's hostname, so they're off; the server
    # still only listens on localhost.
    app = server.mcp.streamable_http_app(
        streamable_http_path=path,
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    tunnel, public = (None, None)
    if not args.no_tunnel and not args.public_url:
        print("Starting a secure Cloudflare tunnel…", flush=True)
        tunnel, public = _start_tunnel(args.port)
        if tunnel is None:
            print(
                "cloudflared isn't available, so Claude on the web can't reach this computer yet. Install it:\n"
                "  Mac:     brew install cloudflared\n"
                "  Windows: winget install --id Cloudflare.cloudflared\n"
                "then start Rough Cut again.",
                flush=True,
            )
        elif public is None:
            print("The tunnel didn't report an address in time; check your internet connection.", flush=True)
    if args.public_url:
        public = args.public_url.rstrip("/")

    lines = ["Rough Cut is running for Claude on the web.", ""]
    if public:
        lines += [
            "In claude.ai: Settings > Connectors > Add custom connector, and paste this URL:",
            "",
            f"  {public}{path}",
            "",
            "Keep it private: anyone with it can see the shared folders' footage.",
        ]
        if tunnel is not None:
            lines.append("This address changes every time; update the connector after each restart.")
    else:
        lines += [f"Local address: http://127.0.0.1:{args.port}{path}",
                  "Put an HTTPS tunnel in front of it and add <tunnel address>" + path + " as a connector."]
    lines += ["", "Shared folders:"] + [f"  {f}" for f in folders] + ["", "Leave this window open. Ctrl+C to stop."]
    _banner(lines)

    try:
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        if tunnel is not None:
            tunnel.terminate()
