import { formatEther, type Address, type Hex, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config as loadEnv } from "dotenv";
import {
  ArenaClient,
  MARKOV_ADDRESS,
  MatchStatus,
} from "./arena.js";
import { Bankroll, type PlayMode } from "./bankroll.js";
import {
  ChallengeAiClient,
  ChallengeAiStaleActionsError,
  isGameArenaBlockedError,
  type RefillOffer,
  type StartMatchResult,
} from "./challenge-ai.js";
import { readGsBalance, sendRefillPayment } from "./refill.js";
import { installLogReporter, reportMatch, reportRefill } from "./reporter.js";
import { GAME_NAMES, pickMove } from "./strategy.js";

loadEnv();
installLogReporter();

const MAX_WAGER_GS = 5;

function envFlag(name: string, defaultOn = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

function resolvePlayMode(): PlayMode {
  const mode = (process.env.PLAY_MODE ?? "offchain").toLowerCase();
  if (mode === "onchain" || mode === "offchain") return mode;
  console.error('PLAY_MODE must be "offchain" or "onchain"');
  process.exit(1);
}

function resolvePlayerAddress(privateKey?: Hex): Address {
  const fromEnv = process.env.PLAYER_ADDRESS?.trim();
  if (fromEnv) {
    if (!isAddress(fromEnv)) {
      console.error("PLAYER_ADDRESS is not a valid address");
      process.exit(1);
    }
    return fromEnv;
  }
  if (privateKey) return privateKeyToAccount(privateKey).address;
  console.error("Set PLAYER_ADDRESS or PRIVATE_KEY");
  process.exit(1);
}

const playMode = resolvePlayMode();
const privateKey = process.env.PRIVATE_KEY?.trim() as Hex | undefined;

if (playMode === "onchain" && !privateKey) {
  console.error("PRIVATE_KEY is required for on-chain play. Copy .env.example to .env");
  process.exit(1);
}

const playerAddress = resolvePlayerAddress(privateKey);
const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const challengeAiUrl =
  process.env.CHALLENGE_AI_URL ?? "https://gamearenahq.xyz";
const wagerGs = Math.min(Number(process.env.WAGER_GS ?? 1), MAX_WAGER_GS);
const gameType = Number(process.env.GAME_TYPE ?? 0);
const lossCapGs = Number(process.env.DAILY_LOSS_CAP_GS ?? 20);
const dailyMatchCap = Number(process.env.DAILY_MATCH_CAP ?? 50);
const dailyRefillCapGs = Number(process.env.DAILY_REFILL_CAP_GS ?? 20);
const maxRefillsPerDay = Number(process.env.MAX_REFILLS_PER_DAY ?? 10);
const autoRefill = envFlag("AUTO_REFILL", true);
const maxMatches = Number(process.env.MAX_MATCHES ?? 10);
const intervalMs =
  Math.max(30, Number(process.env.MATCH_INTERVAL_SECONDS ?? 300)) * 1000;

if (playMode === "offchain" && gameType !== 0) {
  console.error("Off-chain challenge-ai only supports GAME_TYPE=0 (Rock-Paper-Scissors)");
  process.exit(1);
}

if (!(gameType in GAME_NAMES)) {
  console.error(`GAME_TYPE must be one of: ${Object.keys(GAME_NAMES).join(", ")}`);
  process.exit(1);
}

const bankroll = new Bankroll(
  "state.json",
  playMode,
  lossCapGs,
  dailyMatchCap,
  dailyRefillCapGs,
  maxRefillsPerDay,
  {
    onMatch: reportMatch,
    onRefill: reportRefill,
  },
);

const ACCEPT_TIMEOUT_MS = 10 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 15 * 60 * 1000;
const BLOCKED_RETRY_CAP_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Spread agent startups so many PM2 processes do not hit GameArena at once. */
function startupJitterMs(): number {
  const maxSec = Math.max(
    0,
    Number(process.env.STARTUP_JITTER_SECONDS ?? 120),
  );
  if (maxSec === 0) return 0;
  const deployId = process.env.DEPLOY_ID?.trim();
  if (deployId) {
    let h = 0;
    for (let i = 0; i < deployId.length; i++) {
      h = (h * 31 + deployId.charCodeAt(i)) >>> 0;
    }
    return h % (maxSec * 1000);
  }
  return Math.floor(Math.random() * maxSec * 1000);
}

async function connectChallengeAi(): Promise<ChallengeAiClient> {
  let attempt = 0;
  while (true) {
    try {
      return await ChallengeAiClient.create(challengeAiUrl);
    } catch (error) {
      if (!isGameArenaBlockedError(error)) throw error;
      attempt += 1;
      const delayMs = Math.min(
        BLOCKED_RETRY_CAP_MS,
        30_000 * Math.min(attempt, 10) + Math.floor(Math.random() * 10_000),
      );
      console.error(
        `[discovery] GameArena unreachable (${(error as Error).message}) — waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt})`,
      );
      await sleep(delayMs);
    }
  }
}

async function tryAutoRefill(
  client: ChallengeAiClient,
  offer?: RefillOffer,
): Promise<boolean> {
  if (!autoRefill) {
    console.log("[refill] skip — AUTO_REFILL disabled");
    return false;
  }
  if (!privateKey) {
    console.log("[refill] skip — PRIVATE_KEY required to pay for ticket refills");
    return false;
  }
  if (!offer) {
    console.log("[refill] skip — no refill offer from GameArena");
    return false;
  }

  const gate = bankroll.canBuyRefill(offer.priceGs);
  if (!gate.ok) {
    console.log(`[refill] skip — ${gate.reason}`);
    return false;
  }

  try {
    const balance = await readGsBalance(playerAddress, rpcUrl, offer.gToken);
    const need = BigInt(offer.priceGs) * 10n ** 18n;
    if (balance < need) {
      console.log(
        `[refill] skip — G$ balance ${formatEther(balance)} < ${offer.priceGs} G$ needed`,
      );
      return false;
    }

    console.log(
      `[refill] paying ${offer.priceGs} G$ → +${offer.grants} tickets (pool ${offer.poolWallet.slice(0, 10)}…)`,
    );
    const txHash = await sendRefillPayment(privateKey, rpcUrl, offer);
    console.log(`[refill] tx ${txHash}`);

    let credited = await client.purchaseRefill(playerAddress, txHash);
    if (!credited.ok) {
      console.log("[refill] waiting for server to index payment…");
      await new Promise((r) => setTimeout(r, 4000));
      credited = await client.purchaseRefill(playerAddress, txHash);
    }

    if (!credited.ok) {
      console.log(
        `[refill] payment sent but not credited yet (${credited.error ?? "unknown"}) — tx ${txHash}`,
      );
      return false;
    }

    bankroll.recordRefill(offer.priceGs, txHash);
    console.log(
      `[refill] credited · ${credited.remaining ?? "?"} tickets left today`,
    );
    return true;
  } catch (error) {
    console.log(`[refill] failed — ${(error as Error).message}`);
    return false;
  }
}

async function resolveOffchainStart(
  client: ChallengeAiClient,
): Promise<StartMatchResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ladder = await client.getLadder(playerAddress);
    if (
      typeof ladder.remainingToday === "number" &&
      ladder.remainingToday <= 0
    ) {
      const probe = await client.startMatch(playerAddress);
      if (probe.error === "daily_limit" && probe.refill) {
        const refilled = await tryAutoRefill(client, probe.refill);
        if (!refilled) return null;
        continue;
      }
      console.log(
        "[skip] no challenge-ai tickets left today (remainingToday=0)",
      );
      return null;
    }

    console.log(`[start] Rock-Paper-Scissors vs MARKOV (off-chain)…`);
    const started = await client.startMatch(playerAddress);

    if (started.error === "daily_limit") {
      const refilled = await tryAutoRefill(client, started.refill);
      if (!refilled) return null;
      continue;
    }

    if (started.error || !started.matchId) {
      console.log(
        `[skip] could not start match: ${started.error ?? "unknown error"}`,
      );
      return null;
    }

    return started;
  }

  return null;
}

async function playOffchainMatch(
  client: ChallengeAiClient,
): Promise<"played" | "skipped"> {
  const gate = bankroll.canPlay(0);
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  const started = await resolveOffchainStart(client);
  if (!started?.matchId) return "skipped";

  const { matchId, remainingToday, commitHash } = started;
  console.log(
    `[start] match ${matchId} · commit ${commitHash?.slice(0, 10)}… · tickets left ${remainingToday ?? "?"}`,
  );

  let finalOutcome: "won" | "lost" | "unresolved" = "unresolved";

  while (true) {
    const { move, label } = pickMove(0);
    const round = await client.throwMove(matchId, move);

    if (round.error) {
      console.log(`[match ${matchId}] throw error: ${round.error}`);
      break;
    }

    console.log(
      `[match ${matchId}] r${round.round}: ${label} vs move ${round.aiMove} → ${round.result}` +
        (round.called ? " (called)" : "") +
        (round.markovLine ? ` — "${round.markovLine}"` : ""),
    );

    if (round.final) {
      const won = round.final.outcome === "player_won";
      finalOutcome = won ? "won" : "lost";
      console.log(
        `[match ${matchId}] ${won ? "WON" : "LOST"} in ${round.final.totalRounds} rounds` +
          (round.final.matchLine ? ` — "${round.final.matchLine}"` : ""),
      );
      break;
    }
  }

  bankroll.record({
    matchId,
    gameType: 0,
    wagerGs: 0,
    result: finalOutcome,
    mode: "offchain",
    at: new Date().toISOString(),
  });
  return "played";
}

async function playOnchainMatch(arena: ArenaClient): Promise<"played" | "skipped"> {
  const gate = bankroll.canPlay(wagerGs);
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  const { gs, celo } = await arena.balances();
  if (gs < BigInt(wagerGs) * 10n ** 18n) {
    console.log(`[skip] G$ balance too low: ${formatEther(gs)} G$`);
    return "skipped";
  }
  if (celo < 10n ** 16n) {
    console.log(`[skip] CELO gas balance too low: ${formatEther(celo)} CELO`);
    return "skipped";
  }

  console.log(
    `[propose] ${GAME_NAMES[gameType]} vs MARKOV for ${wagerGs} G$…`,
  );
  const matchId = await arena.proposeMatch(MARKOV_ADDRESS, gameType, String(wagerGs));
  console.log(`[propose] match #${matchId} escrowed on-chain`);

  const accepted = await arena.waitForStatus(
    matchId,
    MatchStatus.Accepted,
    ACCEPT_TIMEOUT_MS,
  );
  if (!accepted || accepted.status !== MatchStatus.Accepted) {
    console.log(
      `[match #${matchId}] not accepted in time (MARKOV cap or funds) — cancelling to recover the wager`,
    );
    try {
      await arena.cancelMatch(matchId);
      console.log(`[match #${matchId}] cancelled, wager refunded`);
    } catch (error) {
      console.log(
        `[match #${matchId}] cancel failed (${(error as Error).message}) — it may have just been accepted; will remain on-chain`,
      );
    }
    bankroll.record({
      matchId: matchId.toString(),
      gameType,
      wagerGs,
      result: "unresolved",
      mode: "onchain",
      at: new Date().toISOString(),
    });
    return "played";
  }

  const { move, label } = pickMove(gameType);
  console.log(`[match #${matchId}] accepted — playing ${label}`);
  await arena.playMove(matchId, move);

  const done = await arena.waitForStatus(
    matchId,
    MatchStatus.Completed,
    RESOLVE_TIMEOUT_MS,
  );
  if (!done || done.status !== MatchStatus.Completed) {
    console.log(`[match #${matchId}] not resolved yet — check later`);
    bankroll.record({
      matchId: matchId.toString(),
      gameType,
      wagerGs,
      result: "unresolved",
      mode: "onchain",
      at: new Date().toISOString(),
    });
    return "played";
  }

  const won =
    done.winner.toLowerCase() === arena.account.address.toLowerCase();
  console.log(
    `[match #${matchId}] ${won ? "WON" : "lost"} — winner ${done.winner}`,
  );
  bankroll.record({
    matchId: matchId.toString(),
    gameType,
    wagerGs,
    result: won ? "won" : "lost",
    mode: "onchain",
    at: new Date().toISOString(),
  });
  return "played";
}

async function main(): Promise<void> {
  const jitter = startupJitterMs();
  if (jitter > 0) {
    console.log(
      `[startup] waiting ${Math.round(jitter / 1000)}s (staggered boot for GameArena rate limits)`,
    );
    await sleep(jitter);
  }

  console.log(
    `GameArena player — ${playMode} mode · wallet ${playerAddress}`,
  );

  if (playMode === "offchain") {
    const matchCapLabel = dailyMatchCap > 0 ? `${dailyMatchCap}/day` : "∞/day";
    console.log(
      `game=RPS tickets≤${matchCapLabel} autoRefill=${autoRefill} refillBudget=${dailyRefillCapGs}G$/day maxMatches=${maxMatches || "∞"}`,
    );
    const client = await connectChallengeAi();
    console.log(
      `[discovery] server actions: start=${client.getActionId("startArenaMatch").slice(0, 8)}… throw=${client.getActionId("throwArenaMove").slice(0, 8)}… refill=${client.getActionId("purchaseArenaRefill").slice(0, 8)}…`,
    );

    let played = 0;
    while (maxMatches === 0 || played < maxMatches) {
      try {
        const outcome = await playOffchainMatch(client);
        if (outcome === "skipped") break;
        played += 1;
        console.log(`[bankroll] ${bankroll.summary}`);
      } catch (error) {
        if (error instanceof ChallengeAiStaleActionsError) {
          console.error("[error]", error.message);
          break;
        }
        if (isGameArenaBlockedError(error)) {
          console.error(
            `[pause] ${(error as Error).message} — backing off ${Math.round(BLOCKED_RETRY_CAP_MS / 1000)}s`,
          );
          await sleep(BLOCKED_RETRY_CAP_MS);
          continue;
        }
        console.error("[error]", (error as Error).message);
        break;
      }
      if (maxMatches === 0 || played < maxMatches) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  } else {
    const arena = new ArenaClient(privateKey!, rpcUrl);
    console.log(
      `game=${GAME_NAMES[gameType]} wager=${wagerGs}G$ lossCap=${lossCapGs}G$ maxMatches=${maxMatches || "∞"}`,
    );

    let played = 0;
    while (maxMatches === 0 || played < maxMatches) {
      try {
        const outcome = await playOnchainMatch(arena);
        if (outcome === "skipped") break;
        played += 1;
        console.log(`[bankroll] ${bankroll.summary}`);
      } catch (error) {
        console.error("[error]", (error as Error).message);
      }
      if (maxMatches === 0 || played < maxMatches) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  console.log(`Done. ${bankroll.summary}`);
}

main().catch((error) => {
  if (isGameArenaBlockedError(error)) {
    console.error(
      "[blocked] GameArena still rate-limiting — exiting cleanly; PM2 will retry later",
      (error as Error).message,
    );
    process.exit(0);
    return;
  }
  console.error("[fatal]", (error as Error).message);
  process.exit(1);
});
