#!/bin/bash
# Cloud sessions only: install dependencies and point Playwright at the
# pre-installed Chromium so `pnpm check` and `pnpm test:e2e` work right away.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
pnpm install

# Older containers lack the browser build the pinned Playwright wants; use the
# full Chromium there instead. Newer ones (chrome-linux64) match and skip this.
chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -n 1 || true)
if [ -n "$chrome" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CHROMIUM_PATH=\"$chrome\"" >> "$CLAUDE_ENV_FILE"
fi
