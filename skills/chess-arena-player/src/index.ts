import { config as loadEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { runOneMatch, sleep } from "./match.js";
import { Stats } from "./stats.js";

loadEnv();

const config = loadConfig();
const stats = new Stats("state.json", config.dailyMatchCap);

console.log("Chess Arena player skill");
console.log(`wallet ${config.playerAddress} · ${config.playerName}`);
console.log(`arena ${config.arenaUrl} · contract ${config.arenaContract}`);
console.log(`mode ${config.playMode} · auto-swap ${config.autoSwap ? "on" : "off"}`);
console.log(
  `USDT buffer ${Number(config.usdtStakeBuffer) / 1e6} · G$ reserve ${Number(config.minGsReserve) / 1e18}`,
);
if (config.solverCmd) {
  console.log(
    `solver ${config.solverEngine} (${config.solverCmd}) · ${config.solverMovetimeMs}ms/puzzle`,
  );
} else {
  console.log("solver basic — mate-in-one (chess.js) only");
}

let played = 0;
while (config.maxMatches === 0 || played < config.maxMatches) {
  try {
    const outcome = await runOneMatch(config, stats);
    if (outcome === "skipped") {
      if (!stats.canPlay().ok) break;
      await sleep(config.intervalMs);
      continue;
    }
    played += 1;
    console.log(`[stats] ${stats.summary}`);
  } catch (err) {
    console.error("[error]", (err as Error).message);
  }
  if (config.maxMatches === 0 || played < config.maxMatches) {
    await sleep(config.intervalMs);
  }
}

console.log(`Done. ${stats.summary}`);
