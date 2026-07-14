import { config as loadEnv } from "dotenv";
import { Bot, GrammyError } from "grammy";
import { getAddress, isAddress } from "viem";
import {
  readAuthPeriodDays,
  readPoolStats,
  readWallets,
  type WalletSnapshot,
} from "./chain.js";
import {
  CLAIM_URL,
  identityExpiryLine,
  leaderboardMessage,
  poolStatsMessage,
  reminderMessage,
  shortAddress,
  statusLine,
  streakMessage,
} from "./format.js";
import * as store from "./store.js";

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("[fatal] TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const BOT_NAME = process.env.BOT_NAME?.trim() || "GoodDollar UBI Reminder";
const AGENT_ADDRESS = process.env.AGENT_ADDRESS?.trim() ?? "";
const API_BASE =
  process.env.GOODAGENT_API_BASE?.trim() ?? "https://gcopilot-api.geinz.lol";
const EXPLORER_BASE = "https://goodagentids.xyz";
const INTERVAL_MINUTES = Math.max(
  1,
  Number(process.env.REMINDER_INTERVAL_MINUTES ?? 15),
);
const EXPIRY_WARN_DAYS = Math.max(
  1,
  Number(process.env.IDENTITY_EXPIRY_WARN_DAYS ?? 14),
);

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/;

function log(tag: string, message: string): void {
  const line = `[${tag}] ${message}`;
  console.log(line);
  store.reportLog(line);
}

/* ------------------------------------------------------------------ */
/* Trust line — this bot is itself a GoodAgent-verified agent          */
/* ------------------------------------------------------------------ */

async function agentTrustLine(): Promise<string> {
  if (!AGENT_ADDRESS) return "";
  try {
    const res = await fetch(`${API_BASE}/agent/verify/${AGENT_ADDRESS}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as {
      valid?: boolean;
      agentProven?: boolean;
    };
    if (data.valid) {
      return (
        `✅ I'm a <b>GoodAgent-verified</b> agent — a real human stands behind me with a refundable G$ bond. ` +
        `<a href="${EXPLORER_BASE}/explore/agent/${AGENT_ADDRESS}">Check my agent ID</a> · ` +
        `<a href="${EXPLORER_BASE}/verify?agent=${AGENT_ADDRESS}">verify live</a>.\n\n`
      );
    }
    if (data.agentProven) {
      return (
        `🔐 My agent key is attested on-chain (<code>${shortAddress(AGENT_ADDRESS)}</code>). ` +
        `Human vouch pending.\n\n`
      );
    }
  } catch {
    // Omit trust line if the API is unreachable.
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* Bot commands                                                        */
/* ------------------------------------------------------------------ */

const WELCOME_INTRO =
  `👋 <b>Welcome to ${BOT_NAME}!</b>\n\n` +
  "I'll ping you whenever your daily G$ UBI is ready to claim — and I track " +
  "your on-chain claim streak while I'm at it.\n\n" +
  "Send me your Celo wallet address (the one you claim with) to get started — " +
  "it looks like <code>0x1234…abcd</code>.\n\n";

const WELCOME_OUTRO =
  "I only ever <i>read</i> public chain data. I will never ask for a seed phrase or private key — and neither will anyone from GoodDollar.";

const HELP =
  "<b>Commands</b>\n" +
  "/status — check your wallets right now\n" +
  "/streak — your on-chain claim streaks\n" +
  "/pool — live UBI pool stats from Celo\n" +
  "/top — streak leaderboard\n" +
  "/list — wallets I'm watching for you\n" +
  "/remove <code>0x…</code> — stop watching one wallet\n" +
  "/stop — stop all reminders\n" +
  "/help — this message\n\n" +
  "Send any Celo address to add another wallet.";

const bot = new Bot(token);

bot.command("start", async (ctx) => {
  const trust = await agentTrustLine();
  await ctx.reply(WELCOME_INTRO + trust + WELCOME_OUTRO, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
});

bot.command("help", (ctx) =>
  ctx.reply(HELP, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
);

bot.command("status", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const subs = await store.listChatWallets(chatId);
  if (subs.length === 0) {
    await ctx.reply(
      "No wallets yet — send me a Celo address to start watching it.",
    );
    return;
  }
  const snaps = await readWallets(subs.map((s) => s.wallet));
  const byWallet = new Map(subs.map((s) => [s.wallet.toLowerCase(), s]));
  const lines = snaps
    .map((snap) => statusLine(snap, byWallet.get(snap.wallet.toLowerCase())))
    .join("\n");
  await ctx.reply(lines, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
});

bot.command("streak", async (ctx) => {
  const subs = await store.listChatWallets(String(ctx.chat.id));
  await ctx.reply(streakMessage(subs), { parse_mode: "HTML" });
});

bot.command("pool", async (ctx) => {
  const stats = await readPoolStats();
  await ctx.reply(poolStatsMessage(stats), { parse_mode: "HTML" });
});

bot.command("top", async (ctx) => {
  const rows = await store.leaderboard(10);
  await ctx.reply(leaderboardMessage(rows), { parse_mode: "HTML" });
});

bot.command("list", async (ctx) => {
  const subs = await store.listChatWallets(String(ctx.chat.id));
  if (subs.length === 0) {
    await ctx.reply("No wallets yet — send me a Celo address to add one.");
    return;
  }
  const lines = subs
    .map((s) => `▫️ <code>${s.wallet}</code>`)
    .join("\n");
  await ctx.reply(`Watching:\n${lines}`, { parse_mode: "HTML" });
});

bot.command("remove", async (ctx) => {
  const match = ctx.match?.match(ADDRESS_RE);
  if (!match) {
    await ctx.reply("Usage: /remove 0x… (the wallet to stop watching)");
    return;
  }
  const removed = await store.unsubscribe(String(ctx.chat.id), match[0]);
  await ctx.reply(
    removed > 0
      ? `Stopped watching <code>${shortAddress(match[0])}</code>.`
      : "I wasn't watching that wallet.",
    { parse_mode: "HTML" },
  );
});

bot.command("stop", async (ctx) => {
  const removed = await store.unsubscribe(String(ctx.chat.id));
  await ctx.reply(
    removed > 0
      ? "All reminders stopped. Send a wallet address any time to restart."
      : "You had no active reminders.",
  );
});

/* Any message containing a Celo address subscribes it. */
bot.on("message:text", async (ctx) => {
  const match = ctx.message.text.match(ADDRESS_RE);
  if (!match) {
    await ctx.reply(
      "Send me a Celo wallet address (0x…) to watch, or /help for commands.",
    );
    return;
  }
  if (!isAddress(match[0])) {
    await ctx.reply("That doesn't look like a valid address — double-check it?");
    return;
  }
  const wallet = getAddress(match[0]);
  const chatId = String(ctx.chat.id);
  await store.subscribe(chatId, wallet);
  log("subscribe", `chat=${chatId} wallet=${wallet}`);

  const [snap] = await readWallets([wallet]);
  await ctx.reply(
    `Watching <code>${shortAddress(wallet)}</code> ✓\n\n${statusLine(snap)}`,
    { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
  );
});

/* ------------------------------------------------------------------ */
/* Reminder + streak loop                                              */
/* ------------------------------------------------------------------ */

let authPeriodDays = 360;

function expiryWarning(snap: WalletSnapshot): string | null {
  if (snap.dateAuthenticated <= 0 || !snap.isWhitelisted) return null;
  const expiresAt = snap.dateAuthenticated + authPeriodDays * 86_400;
  const daysLeft = Math.floor((expiresAt - Date.now() / 1000) / 86_400);
  if (daysLeft <= 0 || daysLeft > EXPIRY_WARN_DAYS) return null;
  return identityExpiryLine(snap.wallet, daysLeft);
}

async function runPass(): Promise<void> {
  const subscribers = await store.listAllSubscribers();
  if (subscribers.length === 0) return;

  const pool = await readPoolStats();
  const wallets = [...new Set(subscribers.map((s) => s.wallet.toLowerCase()))];
  const snaps = await readWallets(wallets);
  const byWallet = new Map(snaps.map((s) => [s.wallet.toLowerCase(), s]));

  // On-chain claim detection → streaks. A wallet whose lastClaimed timestamp
  // falls inside the current UBI day has claimed today.
  const claimedToday = snaps
    .filter((s) => s.lastClaimedAt >= pool.dayStart)
    .map((s) => s.wallet);
  await store.recordClaims(claimedToday, pool.currentDay);

  // Reminders — at most one per wallet per UBI day.
  const pending = subscribers.filter(
    (s) => s.lastRemindedDay !== pool.currentDay,
  );
  const byChat = new Map<
    string,
    { subIds: string[]; rows: Array<{ snap: WalletSnapshot; sub: store.Subscriber }> }
  >();
  for (const sub of pending) {
    const snap = byWallet.get(sub.wallet.toLowerCase());
    if (!snap?.eligible) continue;
    const entry = byChat.get(sub.chatId) ?? { subIds: [], rows: [] };
    entry.subIds.push(sub.id);
    entry.rows.push({ snap, sub });
    byChat.set(sub.chatId, entry);
  }

  const remindedIds: string[] = [];
  const blockedChats: string[] = [];

  for (const [chatId, { subIds, rows }] of byChat) {
    const warnings = rows
      .map(({ snap }) => expiryWarning(snap))
      .filter((w): w is string => w !== null);
    try {
      await bot.api.sendMessage(chatId, reminderMessage(rows, warnings), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
      remindedIds.push(...subIds);
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 403) {
        blockedChats.push(chatId);
      } else {
        console.error(`[reminder] failed to message chat ${chatId}:`, error);
      }
    }
  }

  await store.markReminded(remindedIds, pool.currentDay);
  await store.deactivateChats(blockedChats);

  if (remindedIds.length > 0 || blockedChats.length > 0) {
    log(
      "reminder",
      `day=${pool.currentDay} reminded=${remindedIds.length} blocked=${blockedChats.length} claimedToday=${claimedToday.length}`,
    );
  }
}

async function main(): Promise<void> {
  try {
    authPeriodDays = await readAuthPeriodDays();
  } catch {
    log("start", "authenticationPeriod read failed — using 360 days");
  }

  await bot.api.setMyCommands([
    { command: "start", description: "Start and add a wallet" },
    { command: "status", description: "Check claim status now" },
    { command: "streak", description: "Your on-chain claim streaks" },
    { command: "pool", description: "Live UBI pool stats" },
    { command: "top", description: "Streak leaderboard" },
    { command: "list", description: "Show watched wallets" },
    { command: "remove", description: "Stop watching a wallet" },
    { command: "stop", description: "Stop all reminders" },
    { command: "help", description: "How this bot works" },
  ]);

  const tick = () =>
    runPass().catch((error) => console.error("[reminder] pass failed:", error));
  void tick();
  setInterval(tick, INTERVAL_MINUTES * 60_000);

  log(
    "start",
    `${BOT_NAME} scanning every ${INTERVAL_MINUTES} minute(s), expiry warnings at ${EXPIRY_WARN_DAYS} days`,
  );
  void bot.start({
    onStart: (me) => log("start", `bot running as @${me.username}`),
  });
}

void main();
