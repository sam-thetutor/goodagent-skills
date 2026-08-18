import type { SkillConfig } from "./config.js";
import { HttpError, createArenaApi } from "./arena-api.js";
import {
  acceptLobby,
  createChainClients,
  openLobby,
  readStakeAmount,
  refundLobby,
} from "./arena-chain.js";
import { solvePuzzle } from "./solver.js";
import { ensureUsdtFromGs, readUsdtBalance } from "./swap.js";
import type { Stats } from "./stats.js";

export async function runOneMatch(
  config: SkillConfig,
  stats: Stats,
): Promise<"played" | "skipped"> {
  const gate = stats.canPlay();
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  const clients = createChainClients(config);
  const api = createArenaApi(config.arenaUrl, config.account);

  if (config.autoSwap) {
    const usdt = await readUsdtBalance(config.playerAddress, config.rpcUrl);
    const stake = await readStakeAmount(clients);
    const target = config.usdtStakeBuffer > stake ? config.usdtStakeBuffer : stake;
    if (usdt < target) {
      await ensureUsdtFromGs(
        config.account,
        config.rpcUrl,
        target,
        config.minGsReserve,
      );
    }
  }

  const token = await api.signIn();
  const { lobbies, count, capacity } = await api.getOpenLobbies();

  let tournamentId: number;
  let role: "open" | "accept";

  const canAccept =
    (config.playMode === "accept" || config.playMode === "auto") &&
    lobbies.length > 0;

  if (canAccept) {
    const pick = lobbies[0]!;
    tournamentId = pick.id;
    role = "accept";
    console.log(`[accept] tournament ${tournamentId} (open lobbies ${count}/${capacity})`);
    // llms.txt Phase 2: on-chain accept → poll Locked → start session
    await acceptLobby(clients, tournamentId);
    await api.waitForLocked(tournamentId, token);
  } else {
    if (config.playMode === "accept") {
      console.log("[skip] no open lobbies to accept");
      return "skipped";
    }
    if (count >= capacity) {
      console.log(`[skip] lobby capacity full (${count}/${capacity})`);
      return "skipped";
    }
    role = "open";
    console.log("[open] creating lobby…");
    tournamentId = await openLobby(clients);
    console.log(`[open] tournament ${tournamentId}`);
    await api.waitForLobbyIndexed(tournamentId);
    try {
      await api.waitForLobbyServiced(tournamentId);
    } catch (err) {
      console.log(`[open] ${(err as Error).message}`);
      console.log(
        `[open] lobby ${tournamentId} unserviced — call refundLobby after lobbyTimeout if unmatched`,
      );
      return "skipped";
    }
  }

  const matchId = `arena-${tournamentId}`;
  console.log(`[start] match ${matchId} · role ${role} · ${config.playerName}`);

  let sessionId: string;
  try {
    ({ sessionId } = await api.startSession(tournamentId, token));
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      console.log(`[session] NO_LOBBY_CAPACITY for tournament ${tournamentId}`);
      if (role === "open") {
        console.log(`[session] refund via refundLobby(${tournamentId}) after lobbyTimeout`);
      }
      return "skipped";
    }
    throw e;
  }

  console.log(`[session] ${sessionId} · puzzle loop starting`);

  const session = await api.playSession(sessionId, token, (fen, puzzleId) =>
    solvePuzzle(fen, { solverCmd: config.solverCmd }),
  );

  console.log(
    `[session] served ${session.served} · solved ${session.solved} · ratingSum ${session.ratingSum} · ${session.ended}`,
  );

  let result = "pending";
  try {
    const t = await api.waitForSettlement(tournamentId, token);
    result = t.status;
    if (t.winner) {
      const won = t.winner.toLowerCase() === config.playerAddress.toLowerCase();
      console.log(`[result] ${t.status} · winner ${t.winner} · ${won ? "WIN" : "LOSS"}`);
    } else if (t.status === "Refunded") {
      console.log(`[result] Refunded — stake returned`);
    } else {
      console.log(`[result] ${t.status}`);
    }
  } catch (err) {
    console.log(`[result] settlement wait failed: ${(err as Error).message}`);
    try {
      const t = await api.getTournament(tournamentId, token);
      result = t.status;
      console.log(`[result] last known status ${t.status}`);
    } catch {
      console.log("[result] tournament state unavailable");
    }
  }

  stats.record({
    tournamentId,
    role,
    puzzlesSolved: session.solved,
    ratingSum: session.ratingSum,
    result,
    at: new Date().toISOString(),
  });

  return "played";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { sleep, refundLobby };
