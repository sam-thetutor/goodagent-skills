import { config as loadEnv } from "dotenv";
import { formatEther, type Hex } from "viem";
import { ArenaClient, MARKOV_ADDRESS, MatchStatus } from "../src/arena.js";

loadEnv({ path: process.env.ENV_FILE });

const privateKey = process.env.PRIVATE_KEY?.trim() as Hex | undefined;
if (!privateKey) {
  console.error("[fatal] PRIVATE_KEY required");
  process.exit(1);
}

const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const wagerGs = process.env.WAGER_GS ?? "1";
const gameType = Number(process.env.GAME_TYPE ?? 0);
const acceptTimeoutMs = Number(process.env.ACCEPT_TIMEOUT_MS ?? 10 * 60 * 1000);
const pollMs = Number(process.env.POLL_MS ?? 15_000);

const arena = new ArenaClient(privateKey, rpcUrl);

console.log(`[start] on-chain propose vs MARKOV`);
console.log(`[wallet] ${arena.account.address}`);
console.log(`[markov] ${MARKOV_ADDRESS}`);

const { gs, celo } = await arena.balances();
console.log(`[balance] G$=${formatEther(gs)} CELO=${formatEther(celo)}`);

const matchId = await arena.proposeMatch(MARKOV_ADDRESS, gameType, wagerGs);
console.log(`[propose] match #${matchId} escrowed (${wagerGs} G$)`);

const deadline = Date.now() + acceptTimeoutMs;
let lastStatus = -1;
while (Date.now() < deadline) {
  const m = await arena.getMatch(matchId);
  if (m.status !== lastStatus) {
    const label =
      m.status === MatchStatus.Proposed
        ? "Proposed"
        : m.status === MatchStatus.Accepted
          ? "Accepted"
          : m.status === MatchStatus.Completed
            ? "Completed"
            : m.status === MatchStatus.Cancelled
              ? "Cancelled"
              : String(m.status);
    console.log(`[status] match #${matchId} → ${label} (${m.status})`);
    lastStatus = m.status;
  }
  if (m.status === MatchStatus.Accepted) {
    console.log(`[success] MARKOV accepted match #${matchId}`);
    process.exit(0);
  }
  if (m.status === MatchStatus.Completed || m.status === MatchStatus.Cancelled) {
    console.log(`[done] match ended with status ${m.status}`);
    process.exit(m.status === MatchStatus.Completed ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}

console.log(
  `[timeout] MARKOV did not accept within ${Math.round(acceptTimeoutMs / 60000)} min — cancelling`,
);
try {
  await arena.cancelMatch(matchId);
  console.log(`[cancel] match #${matchId} cancelled, wager refunded`);
} catch (error) {
  console.error(`[cancel] failed: ${(error as Error).message}`);
}
process.exit(1);
