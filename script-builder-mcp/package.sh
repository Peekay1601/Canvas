#!/usr/bin/env bash
# Builds the downloadable releases into release/:
#   script-builder.mcpb               one-click install for Claude Desktop
#   script-builder-mcp-<ver>.tgz      npm package (npm install -g ./script-builder-mcp-<ver>.tgz)
#   script-builder-mcp-<ver>.zip      full source, for Claude Code or self-hosting
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
rm -rf release .stage && mkdir -p release .stage

npm ci --silent
npx tsc

# Claude Desktop bundle: built code, fonts and production dependencies only.
cp -r dist fonts manifest.json package.json package-lock.json README.md .stage/
(cd .stage && npm ci --omit=dev --silent)
npx -y @anthropic-ai/mcpb@2.1.2 pack .stage release/script-builder.mcpb

npm pack --pack-destination release >/dev/null
zip -qr "release/script-builder-mcp-$VERSION.zip" README.md package.json package-lock.json tsconfig.json manifest.json \
  Dockerfile package.sh src fonts dist
rm -rf .stage
ls -lh release
