#!/usr/bin/env bash
# Copy the bot's public knowledge files into its OpenClaw workspace.
# Run this after editing anything in workspace/. The bot picks the changes up
# on its next message; no restart needed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Lives outside your home folder on purpose: OpenClaw tells the model its
# workspace path, and a path under /Users/<you> would reveal your username.
WORKSPACE="${SLAYER_WORKSPACE:-/Users/Shared/SlayerBot/workspace}"

mkdir -p "$WORKSPACE"
chmod 755 "$WORKSPACE"
for f in AGENTS.md SOUL.md IDENTITY.md USER.md TOOLS.md; do
  cp "$REPO_DIR/workspace/$f" "$WORKSPACE/$f"
done
# A brand-new workspace may get a first-run BOOTSTRAP.md ritual; the bot
# doesn't need one.
rm -f "$WORKSPACE/BOOTSTRAP.md"

if grep -q '\[FILL IN' "$WORKSPACE/USER.md"; then
  echo "note: workspace/USER.md still has [FILL IN] placeholders."
fi
echo "Synced bot workspace to $WORKSPACE"
