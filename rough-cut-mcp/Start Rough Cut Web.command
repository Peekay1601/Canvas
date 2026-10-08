#!/bin/bash
# Double-click to let Claude on the web (claude.ai) work on footage on this Mac.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv (runs Python for Rough Cut)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh || { echo "Couldn't install uv."; read -r -p "Press Return to close."; exit 1; }
fi

FOLDER=$(osascript -e 'POSIX path of (choose folder with prompt "Choose the footage folder, with the script inside it, to share with Claude")') || exit 0

uv run --directory "$PWD" roughcut-mcp web --folder "$FOLDER"
read -r -p "Rough Cut stopped. Press Return to close."
