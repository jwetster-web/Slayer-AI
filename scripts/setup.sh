#!/usr/bin/env bash
# One-time setup for SlayerBot: a locked-down OpenClaw bot that answers
# Pokémon drop / PokeSlayerz questions in Discord using a local Ollama model.
#
# It runs as its own OpenClaw profile ("slayer"), fully separate from your
# personal OpenClaw: own config, state, credentials, port, and background
# service. Re-running this script is safe; it rewrites the slayer profile only.
#
# Run on the Mac that hosts OpenClaw:
#   ./scripts/setup.sh
#
# Any of these can be set ahead of time instead of answering prompts:
#   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_IDS (comma separated),
#   DISCORD_OWNER_ID, SLAYER_MODEL (Ollama model tag, default gemma4)
# Set SKIP_OLLAMA_PULL=1 or SKIP_SERVICE=1 to skip those steps.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="slayer"
STATE_DIR="$HOME/.openclaw-$PROFILE"
CONFIG_FILE="$STATE_DIR/openclaw.json"
ENV_FILE="$STATE_DIR/.env"
WORKSPACE="${SLAYER_WORKSPACE:-/Users/Shared/SlayerBot/workspace}"
OPENCLAW="${OPENCLAW_BIN:-openclaw}"
oc() { "$OPENCLAW" --profile "$PROFILE" "$@"; }

die() { echo "error: $*" >&2; exit 1; }

ask() {
  # ask VAR "Prompt" [default]
  local var="$1" prompt="$2" def="${3:-}" val
  val="${!var:-}"
  if [ -z "$val" ]; then
    if [ -n "$def" ]; then
      read -r -p "$prompt [$def]: " val || true
      val="${val:-$def}"
    else
      read -r -p "$prompt: " val || true
    fi
  fi
  [ -n "$val" ] || die "$var is required"
  printf -v "$var" '%s' "$val"
}

is_snowflake() { [[ "$1" =~ ^[0-9]{15,22}$ ]]; }

# set_env KEY VALUE: write KEY=VALUE into the profile's private .env
set_env() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/slayer-env.XXXXXX")"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
has_env() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null; }

command -v "$OPENCLAW" >/dev/null || die "openclaw not found. Install it first (see README.md)."
command -v node >/dev/null || die "node not found (OpenClaw needs Node.js)."

echo "== SlayerBot setup =="
echo "Discord IDs: Discord > User Settings > Advanced > Developer Mode, then right-click > Copy ID."
ask DISCORD_GUILD_ID "Server (guild) ID"
ask DISCORD_CHANNEL_IDS "Channel ID(s) the bot may answer in, comma separated"
ask DISCORD_OWNER_ID "Your own Discord user ID"
ask SLAYER_MODEL "Ollama model" "gemma4"

is_snowflake "$DISCORD_GUILD_ID" || die "server ID should be a long number"
is_snowflake "$DISCORD_OWNER_ID" || die "user ID should be a long number"
IFS=',' read -r -a CHANNEL_LIST <<< "${DISCORD_CHANNEL_IDS// /}"
for c in "${CHANNEL_LIST[@]}"; do
  is_snowflake "$c" || die "channel ID '$c' should be a long number"
done

# 1. Secrets -> ~/.openclaw-slayer/.env (chmod 600, never in git).
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
  set_env DISCORD_BOT_TOKEN "$DISCORD_BOT_TOKEN"
elif has_env DISCORD_BOT_TOKEN; then
  echo "Using the Discord bot token already saved in $ENV_FILE"
else
  read -r -s -p "Discord bot token (input hidden): " DISCORD_BOT_TOKEN; echo
  [ -n "$DISCORD_BOT_TOKEN" ] || die "bot token is required"
  set_env DISCORD_BOT_TOKEN "$DISCORD_BOT_TOKEN"
fi
# Local Ollama needs no real key; this marker tells OpenClaw to use it.
has_env OLLAMA_API_KEY || set_env OLLAMA_API_KEY "ollama-local"
# Protects the bot's local control API.
has_env OPENCLAW_GATEWAY_TOKEN || set_env OPENCLAW_GATEWAY_TOKEN "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"

# 2. Bot workspace: only the public knowledge files, nothing else.
SLAYER_WORKSPACE="$WORKSPACE" "$REPO_DIR/scripts/sync-workspace.sh"

# 3. Local model.
if [ "${SKIP_OLLAMA_PULL:-0}" != "1" ]; then
  command -v ollama >/dev/null || die "ollama not found. Install it from https://ollama.com/download"
  ollama pull "$SLAYER_MODEL"
fi

# 4. Write the profile config and validate it.
if [ -f "$CONFIG_FILE" ]; then
  cp "$CONFIG_FILE" "$CONFIG_FILE.bak.$(date +%Y%m%d%H%M%S)"
fi
GUILD="$DISCORD_GUILD_ID" CHANNELS="${CHANNEL_LIST[*]}" OWNER="$DISCORD_OWNER_ID" \
MODEL="ollama/$SLAYER_MODEL" WORKSPACE="$WORKSPACE" \
node "$REPO_DIR/scripts/build-config.mjs" > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
oc config validate

# 5. Run 24/7 as a macOS LaunchAgent (starts at login, restarts on crash).
if [ "${SKIP_SERVICE:-0}" != "1" ]; then
  oc gateway install --force --port 19789
  oc gateway restart || oc gateway start
fi

if [ "$(uname)" = "Darwin" ]; then
  echo
  echo "Note: OpenClaw tells the model this Mac's name: \"$(scutil --get ComputerName 2>/dev/null)\"."
  echo "If that includes your name, rename it (see README, step 6)."
fi

echo
echo "== Security audit =="
oc security audit || true
echo
echo "Done. Check the Discord connection with:"
echo "  openclaw --profile $PROFILE channels status --probe"
echo "Then say hi to the bot in your Discord channel."
