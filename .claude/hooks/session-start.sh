#!/bin/bash
# Cloud sessions only: install dependencies and point Playwright at the
# pre-installed Chromium so `pnpm check` and `pnpm test:e2e` work right away.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
pnpm install

# The Playwright version pinned here wants a browser build the container does
# not have; use the full Chromium that is there.
chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -n 1 || true)
if [ -n "$chrome" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CHROMIUM_PATH=\"$chrome\"" >> "$CLAUDE_ENV_FILE"
fi
