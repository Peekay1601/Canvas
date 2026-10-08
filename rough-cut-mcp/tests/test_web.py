"""Web mode: the HTTP connector only answers on the secret path and only opens shared folders."""

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from test_end_to_end import shoot  # noqa: F401  (fixture)

SRC = str(Path(__file__).resolve().parents[1] / "src")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def web(shoot, tmp_path):  # noqa: F811
    port = free_port()
    env = {"HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "PYTHONPATH": SRC}
    proc = subprocess.Popen(
        [sys.executable, "-c", "from roughcut_mcp.server import main; main()", "web",
         "--folder", str(shoot), "--port", str(port), "--no-tunnel"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env,
    )
    token = None
    deadline = time.time() + 30
    while time.time() < deadline and token is None:
        line = proc.stdout.readline()
        if "/mcp" in line and "127.0.0.1" in line:
            token = line.split(f":{port}/")[1].split("/mcp")[0]
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield f"http://127.0.0.1:{port}", token, shoot
    proc.terminate()


def rpc(url, method, params=None, id_=1):
    body = json.dumps({"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json",
                                             "Accept": "application/json, text/event-stream",
                                             "MCP-Protocol-Version": "2025-06-18"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def test_web_connector(web):
    base, token, shoot_dir = web
    assert token and len(token) >= 32
    url = f"{base}/{token}/mcp"
    init = rpc(url, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "claude.ai", "version": "1"}})
    assert init["result"]["serverInfo"]["name"] == "roughcut"

    tools = rpc(url, "tools/list")["result"]["tools"]
    assert "build_rough_cut" in {t["name"] for t in tools}

    # The first shared folder is the default, so Claude can just pass "".
    opened = rpc(url, "tools/call", {"name": "open_footage_folder", "arguments": {"folder": ""}})["result"]
    assert not opened.get("isError") and "Video clips: 3" in opened["content"][0]["text"]

    clip_id = rpc(url, "tools/call", {"name": "list_footage", "arguments": {"folder": ""}})["result"]["content"][0][
        "text"].splitlines()[1].split(" | ")[0]
    view = rpc(url, "tools/call", {"name": "view_clip", "arguments": {"folder": "", "clip_id": clip_id, "frames": 4}})
    assert any(c["type"] == "image" for c in view["result"]["content"])

    outside = rpc(url, "tools/call", {"name": "open_footage_folder", "arguments": {"folder": str(shoot_dir.parent)}})
    assert outside["result"]["isError"] and "isn't shared" in outside["result"]["content"][0]["text"]

    escape = rpc(url, "tools/call", {"name": "read_script",
                                     "arguments": {"folder": "", "script_file": "../../etc/passwd"}})
    assert escape["result"]["isError"]

    with pytest.raises(urllib.error.HTTPError) as wrong:
        rpc(f"{base}/not-the-token/mcp", "tools/list")
    assert wrong.value.code == 404
