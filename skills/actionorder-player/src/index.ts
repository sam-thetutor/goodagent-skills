import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { ActionOrderClient } from "./client.js";
import { Stats } from "./stats.js";
import {
  buildOrder,
  pickCharacter,
  pickHouseCharacter,
  type Profile,
} from "./strategy.js";
import { getCharacter } from "./cards.js";

loadEnv();

const playerAddress = process.env.PLAYER_ADDRESS;
if (!playerAddress || !/^0x[0-9a-fA-F]{40}$/.test(playerAddress)) {
  console.error(
    "PLAYER_ADDRESS is not set to a valid 0x… address. Copy .env.example to .env first.",
  );
  process.exit(1);
}

const playerName = process.env.PLAYER_NAME ?? "GoodAgent";
const profile: Profile =
  process.env.STRATEGY === "knock_max" ? "knock_max" : "anti_strike";
const characterId = process.env.CHARACTER_ID; // optional; default = best for profile
const difficulty = Math.max(0, Math.min(3, Number(process.env.DIFFICULTY ?? 0)));
const premiumOwned = (process.env.PREMIUM_CARDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const maxMatches = Number(process.env.MAX_MATCHES ?? 5);
const dailyMatchCap = Number(process.env.DAILY_MATCH_CAP ?? 50);
const intervalMs =
  Math.max(3, Number(process.env.MATCH_INTERVAL_SECONDS ?? 10)) * 1000;
const baseUrl = process.env.ACTIONORDER_URL ?? "https://www.actionorder.xyz";

const client = new ActionOrderClient(baseUrl);
const stats = new Stats("state.json", dailyMatchCap);
const character = pickCharacter(characterId, profile);

const ROUND_CAP = 9; // best-of-5 needs 5; cap guards against a stuck match.

function newMatchId(): string {
  return `AO-H-${randomBytes(2).toString("hex").toUpperCase()}`;
}

async function playOneMatch(): Promise<"played" | "skipped"> {
  const gate = stats.canPlay();
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  const matchId = newMatchId();
  const opponentId = pickHouseCharacter(character.id);
  console.log(
    `[match ${matchId}] ${character.name} vs house (${getCharacter(opponentId).name}), difficulty ${difficulty}`,
  );

  let roundsWon = 0;
  let roundsLost = 0;
  let pointsEarned = 0;
  let over = false;

  for (let round = 1; round <= ROUND_CAP && !over; round++) {
    const order = buildOrder(character, premiumOwned, round - 1, profile);
    const res = await client.resolveRound({
      matchId,
      playerAddress: playerAddress as string,
      playerName,
      playerCharacterId: character.id,
      opponentCharacterId: opponentId,
      playerOrderCardIds: order,
      difficulty,
      wagered: false,
      playerUltimateActivated: false,
      attunedCardIds: [],
    });

    roundsWon = res.playerRoundsWon;
    roundsLost = res.opponentRoundsWon;
    pointsEarned = res.pointsEarned;
    over = res.isMatchOver;

    console.log(
      `[match ${matchId}] round ${round}: ${res.roundWinner} ` +
        `(knock ${res.totalPlayerKnock}-${res.totalOpponentKnock}) → ${roundsWon}-${roundsLost}`,
    );
  }

  const won = roundsWon > roundsLost;
  console.log(
    `[match ${matchId}] ${won ? "WON" : "lost"} ${roundsWon}-${roundsLost} · ${pointsEarned} pts`,
  );
  stats.record({
    matchId,
    character: character.id,
    result: won ? "won" : "lost",
    roundsWon,
    roundsLost,
    pointsEarned,
    at: new Date().toISOString(),
  });
  return "played";
}

console.log(`ACTION-ORDER player skill — ${playerName} (${playerAddress})`);
console.log(
  `character=${character.name} strategy=${profile} difficulty=${difficulty} maxMatches=${maxMatches || "∞"} interval=${intervalMs / 1000}s`,
);

const online = await client.online().catch(() => 0);
console.log(`[live] ${online} players online at ACTION-ORDER`);

let played = 0;
while (maxMatches === 0 || played < maxMatches) {
  try {
    const outcome = await playOneMatch();
    if (outcome === "skipped") break;
    played += 1;
    console.log(`[stats] ${stats.summary}`);
  } catch (error) {
    console.error("[error]", (error as Error).message);
  }
  if (maxMatches === 0 || played < maxMatches) {
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

console.log(`Done. ${stats.summary}`);
