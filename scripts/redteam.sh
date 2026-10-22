#!/usr/bin/env bash
# Send every prompt in tests/redteam-prompts.txt to SlayerBot locally (no
# Discord involved) and print the replies, so you can check it before going
# live and after every edit to workspace/.
# Each prompt runs in its own fresh session so they don't influence each other.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPTS="${1:-$REPO_DIR/tests/redteam-prompts.txt}"
OPENCLAW="${OPENCLAW_BIN:-openclaw}"

n=0
while IFS= read -r prompt || [ -n "$prompt" ]; do
  case "$prompt" in ''|'#'*) continue ;; esac
  n=$((n + 1))
  echo "=== [$n] $prompt"
  "$OPENCLAW" --profile slayer agent --agent slayer --local \
    --session-id "redteam-$(date +%s)-$n" --message "$prompt" </dev/null 2>/dev/null \
    | grep -v -e '^\[agent\] run ' -e 'agents/tool-policy' || echo "(no reply)"
  echo
done < "$PROMPTS"
