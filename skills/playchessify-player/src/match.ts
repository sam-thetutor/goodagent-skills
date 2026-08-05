import type { LocalAccount } from "viem";
import {
  didAgentWin,
  ensureChessBankroll,
  findJoinableBotLobby,
  GameStatus,
  joinGame,
  readGame,
  sideToMove,
  type ChainClients,
} from "./chain.js";
import { pickMove, replayMoves, type CoachEngine } from "./engine.js";
import { canonicalMoveMessage, PlayChessifyRelay } from "./relay.js";
import type { Stats } from "./stats.js";
import {
  cancelGame,
  createGame,
  findJoinableOpenLobby,
  joinOpenLobby,
  JOIN_WINDOW_SECS,
  waitUntilActive,
  type OpenLobbyTarget,
} from "./lobby.js";

export type PlayMode = "bot" | "host" | "join";

export interface MatchContext {
  clients: ChainClients;
  relay: PlayChessifyRelay;
  account: LocalAccount;
  playerAddress: `0x${string}`;
  engine: CoachEngine;
  stats: Stats;
  pollMs: number;
  thinkMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function opponentLabel(target: OpenLobbyTarget | { botName: string }): string {
  if ("botName" in target) return target.botName;
  if (target.isBotHost) return `bot:${target.creator.slice(0, 10)}…`;
  return `agent:${target.creator.slice(0, 10)}…`;
}

export async function playMovesUntilDone(ctx: MatchContext, gameId: number): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const game = await readGame(ctx.clients, gameId);
    if (game.status === GameStatus.Active) break;
    await sleep(1000);
  }

  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    const game = await readGame(ctx.clients, gameId);
    if (game.status !== GameStatus.Active) return;

    const moves = await ctx.relay.getMoves(gameId);
    const board = replayMoves(moves.map((m) => m.san));
    if (board.isGameOver()) return;

    const mover = sideToMove(game, moves.length);
    if (mover.toLowerCase() !== ctx.playerAddress.toLowerCase()) {
      await sleep(ctx.pollMs);
      continue;
    }

    await sleep(ctx.thinkMs);
    const chosen = pickMove(board, ctx.engine);
    if (!chosen) {
      console.warn(`[game ${gameId}] no legal move`);
      await sleep(ctx.pollMs);
      continue;
    }

    board.move(chosen);
    const moveNumber = moves.length + 1;
    const message = canonicalMoveMessage({
      chain: "celo",
      gameId,
      moveNumber,
      san: chosen.san,
      fen: board.fen(),
    });
    const sig = await ctx.account.signMessage({ message });

    await ctx.relay.postMove({
      gameId,
      san: chosen.san,
      player: ctx.playerAddress,
      moveNumber,
      sig,
    });
    console.log(`[game ${gameId}] ${moveNumber}. ${chosen.san}`);

    if (board.isGameOver()) return;
    await sleep(ctx.pollMs);
  }
}

async function settleAndRecord(
  ctx: MatchContext,
  gameId: number,
  opponent: string,
  wagerChess: number,
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const game = await readGame(ctx.clients, gameId);
    if (game.status === GameStatus.Finished || game.status === GameStatus.Draw) {
      const outcome = didAgentWin(game, ctx.playerAddress);
      console.log(`[game ${gameId}] finished → ${outcome}`);
      ctx.stats.record({
        matchId: `PC-${gameId}`,
        gameId,
        opponent,
        result: outcome === "unknown" ? "lost" : outcome,
        wagerChess,
        at: new Date().toISOString(),
      });
      return;
    }
    await sleep(2000);
  }
  console.warn(`[game ${gameId}] timed out waiting for settlement`);
}

export async function runBotMatch(
  ctx: MatchContext,
  opts: { maxWager: number; minElo: number; maxElo: number },
): Promise<"played" | "skipped"> {
  const gate = ctx.stats.canPlay();
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  await ensureChessBankroll(ctx.clients);

  const target = await findJoinableBotLobby(ctx.clients, {
    maxWagerWhole: opts.maxWager,
    minElo: opts.minElo,
    maxElo: opts.maxElo,
  });
  if (!target) {
    console.log("[skip] no joinable bot lobby in Elo/wager range — retry later");
    return "skipped";
  }

  console.log(
    `[join] game ${target.gameId} vs ${target.botName} (~${target.targetRating} Elo) · ${target.wagerWhole} CHESS`,
  );
  await joinGame(ctx.clients, target.gameId);
  await playMovesUntilDone(ctx, target.gameId);
  await settleAndRecord(ctx, target.gameId, target.botName, target.wagerWhole);
  return "played";
}

export async function runHostMatch(
  ctx: MatchContext,
  opts: { wagerWhole: number; joinWaitMs: number },
): Promise<"played" | "skipped"> {
  const gate = ctx.stats.canPlay();
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  await ensureChessBankroll(ctx.clients);

  const gameId = await createGame(ctx.clients, opts.wagerWhole);
  console.log(`[host] created game #${gameId} · ${opts.wagerWhole} CHESS · waiting for opponent…`);
  console.log(`[host] share JOIN_GAME_ID=${gameId} with the joining agent`);

  try {
    await waitUntilActive(ctx.clients, gameId, opts.joinWaitMs, 3000);
  } catch {
    console.warn(`[host] no join within window — cancelling game ${gameId}`);
    try {
      await cancelGame(ctx.clients, gameId);
      console.log(`[host] cancelled game ${gameId}, wager refunded`);
    } catch (err) {
      console.error(`[host] cancel failed`, (err as Error).message);
    }
    return "skipped";
  }

  const game = await readGame(ctx.clients, gameId);
  const opponent = game.black.slice(0, 10) + "…";
  console.log(`[host] opponent joined: ${game.black}`);
  await playMovesUntilDone(ctx, gameId);
  await settleAndRecord(ctx, gameId, opponent, opts.wagerWhole);
  return "played";
}

export async function runJoinMatch(
  ctx: MatchContext,
  opts: { maxWager: number; joinGameId?: number; botsOnly: boolean },
): Promise<"played" | "skipped"> {
  const gate = ctx.stats.canPlay();
  if (!gate.ok) {
    console.log(`[skip] ${gate.reason}`);
    return "skipped";
  }

  await ensureChessBankroll(ctx.clients);

  const target = await findJoinableOpenLobby(ctx.clients, {
    maxWagerWhole: opts.maxWager,
    excludeBots: !opts.botsOnly && !opts.joinGameId,
    joinGameId: opts.joinGameId,
  });

  if (!target) {
    if (opts.joinGameId) {
      console.log(`[skip] JOIN_GAME_ID=${opts.joinGameId} not joinable`);
    } else {
      console.log("[skip] no joinable open lobby — retry later or set JOIN_GAME_ID");
    }
    return "skipped";
  }

  console.log(
    `[join] game ${target.gameId} vs ${opponentLabel(target)} · ${target.wagerWhole} CHESS`,
  );
  await joinOpenLobby(ctx.clients, target.gameId);
  await playMovesUntilDone(ctx, target.gameId);
  await settleAndRecord(ctx, target.gameId, opponentLabel(target), target.wagerWhole);
  return "played";
}

export function resolvePlayMode(raw: string | undefined): PlayMode {
  const mode = (raw ?? "bot").trim().toLowerCase();
  if (mode === "host" || mode === "join") return mode;
  return "bot";
}

export function defaultJoinWaitMs(): number {
  return Math.max(60_000, (JOIN_WINDOW_SECS - 60) * 1000);
}
