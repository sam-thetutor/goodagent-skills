import { config as loadEnv } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createChainClients } from "./chain.js";
import { presetLabel, resolveEngine } from "./presets.js";
import { PlayChessifyRelay } from "./relay.js";
import {
  defaultJoinWaitMs,
  resolvePlayMode,
  runBotMatch,
  runHostMatch,
  runJoinMatch,
  type MatchContext,
} from "./match.js";
import { Stats } from "./stats.js";

loadEnv();

const privateKey = (process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY)?.trim() as
  | Hex
  | undefined;
if (!privateKey) {
  console.error("PRIVATE_KEY (or AGENT_PRIVATE_KEY) required for on-chain play + signed moves");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
const playerAddress = (process.env.PLAYER_ADDRESS?.trim() || account.address) as `0x${string}`;
if (playerAddress.toLowerCase() !== account.address.toLowerCase()) {
  console.error("PLAYER_ADDRESS must match PRIVATE_KEY wallet");
  process.exit(1);
}

const playMode = resolvePlayMode(process.env.PLAY_MODE);
const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const baseUrl = (process.env.PLAYCHESSIFY_URL ?? "https://celo.playchessify.xyz").replace(
  /\/$/,
  "",
);
const playerName = process.env.PLAYER_NAME ?? "GoodAgent";
const maxWager = Number(process.env.MAX_WAGER ?? 100);
const hostWager = Number(process.env.HOST_WAGER ?? maxWager);
const minBotElo = Number(process.env.TARGET_BOT_MIN_ELO ?? 600);
const maxBotElo = Number(process.env.TARGET_BOT_MAX_ELO ?? 1200);
const joinGameId = Number(process.env.JOIN_GAME_ID ?? 0) || undefined;
const joinWaitMs = Number(process.env.JOIN_WAIT_MS ?? defaultJoinWaitMs());
const maxMatches = Number(process.env.MAX_MATCHES ?? 3);
const dailyMatchCap = Number(process.env.DAILY_MATCH_CAP ?? 20);
const intervalMs = Math.max(10, Number(process.env.MATCH_INTERVAL_SECONDS ?? 60)) * 1000;
const pollMs = Math.max(500, Number(process.env.MOVE_POLL_MS ?? 1500));
const thinkMs = Math.max(0, Number(process.env.THINK_DELAY_MS ?? 2500));

const { preset, engine } = resolveEngine();
const clients = createChainClients(privateKey, rpcUrl);
const relay = new PlayChessifyRelay(baseUrl);
const stats = new Stats("state.json", dailyMatchCap);

const ctx: MatchContext = {
  clients,
  relay,
  account,
  playerAddress,
  engine,
  stats,
  pollMs,
  thinkMs,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function playOneRound(): Promise<"played" | "skipped"> {
  if (playMode === "host") {
    return runHostMatch(ctx, { wagerWhole: hostWager, joinWaitMs });
  }
  if (playMode === "join") {
    return runJoinMatch(ctx, {
      maxWager,
      joinGameId,
      botsOnly: false,
    });
  }
  return runBotMatch(ctx, {
    maxWager,
    minElo: minBotElo,
    maxElo: maxBotElo,
  });
}

console.log("PlayChessify player skill");
console.log(`wallet ${playerAddress} · ${playerName}`);
console.log(`mode ${playMode} · chain Celo · token CHESS (faucet) · gas CELO`);
console.log(
  `strategy ${presetLabel(preset)} (depth ${engine.depth}, topK ${engine.topK}, temp ${engine.temperature})`,
);
if (playMode === "bot") {
  console.log(`targets bot Elo ${minBotElo}-${maxBotElo} · max wager ${maxWager} CHESS`);
} else if (playMode === "host") {
  console.log(`host wager ${hostWager} CHESS · join window ${Math.round(joinWaitMs / 1000)}s`);
} else {
  console.log(
    `join max wager ${maxWager} CHESS` +
      (joinGameId ? ` · JOIN_GAME_ID=${joinGameId}` : " · scan open lobbies"),
  );
}
console.log(`relay ${baseUrl}`);
console.log(`game ${clients.game} · token ${clients.token}`);

let played = 0;
while (maxMatches === 0 || played < maxMatches) {
  try {
    const outcome = await playOneRound();
    if (outcome === "skipped") {
      if (!stats.canPlay().ok) break;
      if (playMode === "host") break;
      await sleep(intervalMs);
      continue;
    }
    played += 1;
    console.log(`[stats] ${stats.summary}`);
  } catch (err) {
    console.error("[error]", (err as Error).message);
  }
  if (maxMatches === 0 || played < maxMatches) await sleep(intervalMs);
}

console.log(`Done. ${stats.summary}`);
