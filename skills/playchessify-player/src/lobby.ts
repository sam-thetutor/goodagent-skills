import type { Address, Hex } from "viem";
import { decodeEventLog, parseUnits } from "viem";
import { isFleetBotAddress } from "./bots.js";
import {
  CHESS_GAME_ABI,
  GameStatus,
  isLobbyJoinableOnChain,
  joinGame,
  readGame,
  TOKEN_DECIMALS,
  type ChainClients,
  type OnchainGame,
} from "./chain.js";

export { JOIN_WINDOW_BLOCKS, JOIN_WINDOW_SECS } from "./chain.js";

export interface OpenLobbyTarget {
  gameId: number;
  creator: Address;
  wagerWhole: number;
  isBotHost: boolean;
}

export async function createGame(
  clients: ChainClients,
  wagerWhole: number,
): Promise<number> {
  const wager = parseUnits(String(wagerWhole), TOKEN_DECIMALS);
  const hash = await clients.walletClient.writeContract({
    account: clients.signer,
    address: clients.game,
    abi: CHESS_GAME_ABI,
    functionName: "createGame",
    args: [wager],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: CHESS_GAME_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "GameCreated") {
        return Number((decoded.args as { gameId: bigint }).gameId);
      }
    } catch {
      // not our event
    }
  }
  throw new Error("createGame: GameCreated event not found");
}

export async function cancelGame(clients: ChainClients, gameId: number): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    account: clients.signer,
    address: clients.game,
    abi: CHESS_GAME_ABI,
    functionName: "cancelGame",
    args: [BigInt(gameId)],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
}

export async function waitUntilActive(
  clients: ChainClients,
  gameId: number,
  timeoutMs: number,
  pollMs: number,
): Promise<OnchainGame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await readGame(clients, gameId);
    if (game.status === GameStatus.Active) return game;
    if (game.status !== GameStatus.Waiting) {
      throw new Error(`game ${gameId} no longer waiting (status ${game.status})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`game ${gameId} join timeout`);
}

/** Join a specific lobby by id (must be Waiting + canJoin). */
export async function joinOpenLobby(clients: ChainClients, gameId: number): Promise<OpenLobbyTarget> {
  const game = await readGame(clients, gameId);
  if (game.status !== GameStatus.Waiting) {
    throw new Error(`game ${gameId} is not waiting`);
  }
  if (game.white.toLowerCase() === clients.account.toLowerCase()) {
    throw new Error(`cannot join your own lobby (${gameId})`);
  }

  await joinGame(clients, gameId);
  return {
    gameId,
    creator: game.white,
    wagerWhole: Number(game.wager) / 10 ** TOKEN_DECIMALS,
    isBotHost: isFleetBotAddress(game.white),
  };
}

/** Scan recent games for any joinable lobby (human, agent, or bot). */
export async function findJoinableOpenLobby(
  clients: ChainClients,
  opts: {
    maxWagerWhole: number;
    excludeBots?: boolean;
    joinGameId?: number;
  },
): Promise<OpenLobbyTarget | null> {
  if (opts.joinGameId != null && opts.joinGameId > 0) {
    try {
      const game = await readGame(clients, opts.joinGameId);
      if (game.status !== GameStatus.Waiting) return null;
      if (game.white.toLowerCase() === clients.account.toLowerCase()) return null;
      if (!(await isLobbyJoinableOnChain(clients, game))) return null;
      const wagerWhole = Number(game.wager) / 10 ** TOKEN_DECIMALS;
      if (wagerWhole > opts.maxWagerWhole) return null;
      if (opts.excludeBots && isFleetBotAddress(game.white)) return null;
      return {
        gameId: opts.joinGameId,
        creator: game.white,
        wagerWhole,
        isBotHost: isFleetBotAddress(game.white),
      };
    } catch {
      return null;
    }
  }

  const nonce = (await clients.publicClient.readContract({
    address: clients.game,
    abi: CHESS_GAME_ABI,
    functionName: "gameNonce",
  })) as bigint;
  const lastId = Number(nonce) - 1;
  if (lastId < 0) return null;

  const candidates: OpenLobbyTarget[] = [];
  for (let id = lastId; id >= Math.max(0, lastId - 24); id--) {
    let game: OnchainGame;
    try {
      game = await readGame(clients, id);
    } catch {
      continue;
    }
    if (!(await isLobbyJoinableOnChain(clients, game))) continue;
    if (game.status !== GameStatus.Waiting) continue;
    if (game.white.toLowerCase() === clients.account.toLowerCase()) continue;
    if (opts.excludeBots && isFleetBotAddress(game.white)) continue;

    const wagerWhole = Number(game.wager) / 10 ** TOKEN_DECIMALS;
    if (wagerWhole > opts.maxWagerWhole) continue;

    candidates.push({
      gameId: id,
      creator: game.white,
      wagerWhole,
      isBotHost: isFleetBotAddress(game.white),
    });
  }

  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export type { ChainClients, Hex };
