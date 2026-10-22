// Prints the complete openclaw.json for the isolated "slayer" OpenClaw
// profile. Inputs come from env vars set by setup.sh.
//
// Security model: this profile has its own config, state, credentials, and
// gateway process, separate from your personal OpenClaw. Its only agent has
// no tools, so even a successful prompt injection can't run commands, read
// files, browse, or change config. The only things it can leak are what's in
// its own workspace files, so keep those public.

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing env var ${name}`);
  return value;
};

const guildId = env("GUILD");
const channelIds = env("CHANNELS").split(/\s+/).filter(Boolean);
const ownerId = env("OWNER");
const workspace = env("WORKSPACE");

const channels = Object.fromEntries(
  channelIds.map((id) => [id, { enabled: true, requireMention: false }]),
);

const config = {
  gateway: {
    mode: "local",
    bind: "loopback",
    // Default OpenClaw uses 18789; stay 1000 ports away so both can run.
    port: 19789,
    auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
  },
  session: { dmScope: "per-channel-peer" },
  agents: {
    defaults: {
      workspace,
      model: { primary: env("MODEL"), fallbacks: [] },
      skipBootstrap: true,
      heartbeat: { every: "0m" },
    },
    list: [
      {
        id: "slayer",
        default: true,
        name: "SlayerBot",
        identity: { name: "SlayerBot", emoji: "⚔️" },
        skills: [],
      },
    ],
  },
  tools: {
    profile: "minimal",
    deny: ["group:openclaw", "group:plugins"],
    elevated: { enabled: false },
  },
  browser: { enabled: false },
  commands: {
    // Only you can use /commands (like /model, /status, /reset) in Discord.
    allowFrom: { discord: [`user:${ownerId}`] },
    native: false,
    bash: false,
    config: false,
    mcp: false,
    plugins: false,
    debug: false,
  },
  channels: {
    discord: {
      enabled: true,
      token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
      // DMs: only you (for testing). Members ask in the server channels.
      dmPolicy: "allowlist",
      allowFrom: [`discord:${ownerId}`],
      // Server: only your server, only the listed channels.
      groupPolicy: "allowlist",
      allowBots: false,
      guilds: {
        [guildId]: {
          requireMention: true,
          ignoreOtherMentions: true,
          channels,
        },
      },
    },
  },
};

process.stdout.write(JSON.stringify(config, null, 2) + "\n");
