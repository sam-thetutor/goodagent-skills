import { formatEther, type Hex } from "viem";
import { config as loadEnv } from "dotenv";
import {
  ArenaClient,
  MARKOV_ADDRESS,
  MatchStatus,
} from "./arena.js";
import { Bankroll } from "./bankroll.js";
import { GAME_NAMES, pickMove } from "./strategy.js";

loadEnv();

const MAX_WAGER_GS = 5; // hard cap from SKILL.md — do not raise

const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey) {
  console.error("PRIVATE_KEY is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const wagerGs = Math.min(Number(process.env.WAGER_GS ?? 1), MAX_WAGER_GS);
const gameType = Number(process.env.GAME_TYPE ?? 0);
const lossCapGs = Number(process.env.DAILY_LOSS_CAP_GS ?? 20);
const maxMatches = Number(process.env.MAX_MATCHES ?? 10);
const intervalMs =
  Math.max(30, Number(process.env.MATCH_INTERVAL_SECONDS ?? 300)) * 1000;

if (!(gameType in GAME_NAMES)) {
  console.error(`GAME_TYPE must be one of: ${Object.keys(GAME_NAMES).join(", ")}`);
  process.exit(1);
}

const arena = new ArenaClient(privateKey, rpcUrl);
const bankroll = new Bankroll("state.json", lossCapGs);

const ACCEPT_TIMEOUT_MS = 10 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 15 * 60 * 1000;

async function playOneMatch(): Promise<"played" | "skipped"> {
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
      // Race: MARKOV may have accepted between the poll and the cancel.
      console.log(
        `[match #${matchId}] cancel failed (${(error as Error).message}) — it may have just been accepted; will remain on-chain`,
      );
    }
    bankroll.record({
      matchId: matchId.toString(),
      gameType,
      wagerGs,
      result: "unresolved",
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
    at: new Date().toISOString(),
  });
  return "played";
}

console.log(`GameArena player skill — agent wallet ${arena.account.address}`);
console.log(
  `game=${GAME_NAMES[gameType]} wager=${wagerGs}G$ lossCap=${lossCapGs}G$ maxMatches=${maxMatches || "∞"}`,
);

let played = 0;
while (maxMatches === 0 || played < maxMatches) {
  try {
    const outcome = await playOneMatch();
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

console.log(`Done. ${bankroll.summary}`);
