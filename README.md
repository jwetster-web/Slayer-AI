# SlayerBot

A 24/7 Discord bot for the **PokeSlayerz** server. It answers questions about
Pokémon TCG drops, restocks, and PokeSlayerz itself. It runs on your own Mac
using [OpenClaw](https://openclaw.ai) and a local [Ollama](https://ollama.com)
model, so no cloud AI service is involved.

## How it stays safe

The bot is built so that leaking something sensitive takes more than a clever
prompt. The safety comes from what the bot can reach, not just what it's told.

| Layer | What it does |
| --- | --- |
| **Separate OpenClaw profile** (`--profile slayer`) | The bot has its own config, state, credentials, and background service in `~/.openclaw-slayer`. It can't see your personal OpenClaw agent, its memory, or its logins. |
| **Zero tools** | No shell, files, web, browser, cron, or Discord moderation. Even if someone talks the model into "running a command", there is nothing to run. Verified: the model receives an empty tool list. |
| **Public-only knowledge** | The model only sees the files in `workspace/`. Put nothing there you wouldn't post in a public channel. |
| **Discord allowlists** | Only your server, only the channels you pick. DMs are limited to you. Other bots are ignored. |
| **Owner-only commands** | Only your Discord account can use OpenClaw commands like `/model`, `/status`, or `/reset`. |
| **Rules in `workspace/AGENTS.md`** | The model is told never to reveal its instructions, host details, member info, or how restocks are monitored, and to ignore "ignore previous instructions" tricks. Small local models *can* be talked around these rules sometimes, which is why the layers above matter more. |

## What you need

- A Mac that stays on (Apple silicon with 16 GB+ RAM recommended)
- [Ollama](https://ollama.com/download)
- [OpenClaw](https://openclaw.ai): `curl -fsSL https://openclaw.ai/install.sh | bash`
- Admin rights on your Discord server

## Setup

### 1. Create the Discord app

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**. Name it, for example `SlayerBot`.
2. Open **Bot**, set the username and avatar, then under **Privileged Gateway
   Intents** turn on **Message Content Intent**.
3. Still on **Bot**, click **Reset Token** and copy the token. Treat it like a
   password: never paste it in Discord or commit it to git.
4. Open **OAuth2 > URL Generator**. Tick `bot` and `applications.commands`, then
   under Bot Permissions tick: **View Channels**, **Send Messages**,
   **Read Message History**, **Embed Links**, and **Send Messages in Threads**.
   Don't give it Administrator or moderation permissions.
5. Open the generated URL, pick your server, and authorize.

### 2. Get your IDs

In Discord: **User Settings > Advanced > Developer Mode** on. Then right-click to
**Copy ID** for:

- your **server**
- the **channel(s)** where the bot should answer (for example a new `#ask-slayerbot`)
- **yourself** (your user ID)

### 3. Fill in the knowledge base

Edit [`workspace/USER.md`](workspace/USER.md) and replace every `[FILL IN]`
with your real channel names, alert info, membership details, upcoming
releases, and FAQ. Optionally tweak the bot's personality in
[`workspace/SOUL.md`](workspace/SOUL.md).

### 4. Run setup

```bash
git clone https://github.com/jwetster-web/Slayer-AI.git
cd Slayer-AI
./scripts/setup.sh
```

It asks for the IDs, the bot token (hidden input), and the Ollama model
(default `gemma4`), then:

- saves secrets to `~/.openclaw-slayer/.env` (readable only by you)
- copies `workspace/` to `/Users/Shared/SlayerBot/workspace`
- pulls the model with Ollama
- writes and validates `~/.openclaw-slayer/openclaw.json`
- installs a LaunchAgent so the bot starts at login and restarts if it crashes
- runs `openclaw security audit`

It doesn't touch your existing `~/.openclaw` setup. Running it again is safe;
it backs up the previous slayer config first.

**Model choice:** `gemma4` is OpenClaw's suggested local default. Bigger models
follow the safety rules more reliably. If your Mac has 32 GB+ RAM, try a
larger model, for example `SLAYER_MODEL=gpt-oss:20b ./scripts/setup.sh`.

### 5. Test before going live

```bash
./scripts/redteam.sh
```

This sends every prompt in [`tests/redteam-prompts.txt`](tests/redteam-prompts.txt)
to the bot locally and prints the replies. Check that it answers the normal
questions and refuses the jailbreak attempts without leaking anything. If a
reply leaks, tighten `workspace/AGENTS.md` or try a larger model, then run it
again.

Then check Discord:

```bash
openclaw --profile slayer channels status --probe
```

Post a question in your bot channel. In other channels the bot stays silent.

### 6. Keep it running 24/7 and private

- **Don't let the Mac sleep:** System Settings > Energy (or Battery > Options):
  turn on *Prevent automatic sleeping when the display is off* and *Start up
  automatically after a power failure*.
- **Stay logged in:** the bot runs as a LaunchAgent, which only runs while your
  user is logged in. Use automatic login, or just don't log out.
- **Start Ollama at login:** the Ollama app does this by default. Check that it
  appears in the menu bar after a reboot.
- **Rename the Mac if its name includes yours.** OpenClaw tells the model the
  computer's name (for example "Jane's MacBook Pro"). Change it under System
  Settings > General > About > Name, or with
  `sudo scutil --set ComputerName "SlayerBot-Host"`, then restart the bot.

## Day-to-day

| Task | Command |
| --- | --- |
| Update the knowledge base | edit `workspace/*.md`, then `./scripts/sync-workspace.sh` (no restart needed) |
| Restart the bot | `openclaw --profile slayer gateway restart` |
| Stop the bot | `openclaw --profile slayer gateway stop` |
| View logs | `openclaw --profile slayer logs` |
| Health check | `openclaw --profile slayer status` |
| Switch model | `ollama pull <model>`, then rerun `./scripts/setup.sh` with `SLAYER_MODEL=<model>` |
| Add/remove bot channels | rerun `./scripts/setup.sh` |
| Remove the bot entirely | `openclaw --profile slayer gateway uninstall`, then delete `~/.openclaw-slayer` and `/Users/Shared/SlayerBot` |

## Files

```
workspace/          What the model sees (public info only!)
  AGENTS.md         Rules and safety boundaries
  SOUL.md           Personality and tone
  IDENTITY.md       Name and emoji
  USER.md           PokeSlayerz knowledge base: fill this in
  TOOLS.md          Tells the model it has no tools
scripts/
  setup.sh          One-time (re)install
  build-config.mjs  Generates the locked-down OpenClaw config
  sync-workspace.sh Pushes workspace edits to the live bot
  redteam.sh        Runs the test prompts against the bot locally
tests/
  redteam-prompts.txt
```

## Customizing access

These live in `scripts/build-config.mjs`. Rerun `./scripts/setup.sh` after
changing them.

- **Answer anywhere when @mentioned:** remove the `channels` block under the
  guild. The bot then answers in any channel, but only when mentioned.
- **Let members DM the bot:** set `dmPolicy: "open"` and `allowFrom: ["*"]`.
  Each DM gets its own session (`session.dmScope: "per-channel-peer"`).
- **Docker sandbox for extra isolation:** if Docker Desktop is installed, add
  `sandbox: { mode: "all", scope: "agent" }` to the agent. With zero tools
  there's little left for it to contain, but it's there as defense in depth.
