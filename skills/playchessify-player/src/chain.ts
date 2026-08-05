import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { fleetBotByAddress, isFleetBotAddress } from "./bots.js";

export const TOKEN_DECIMALS = 6;
export const GameStatus = {
  Waiting: 0,
  Active: 1,
  Finished: 2,
  Cancelled: 3,
  Draw: 4,
} as const;

const CHESS_TOKEN_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "faucetClaim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "faucetCooldownRemaining",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Handover / on-chain app UI (v1 layout — block-based createdAt, 7-field getGame). */
export const CHESS_GAME_V1 = "0xb37877a9ebd6c3169b2eaaa3e16852839785ae85" as Address;
export const CHESS_TOKEN_V1 = "0x3f7efdfc8a76f76f22512fcd2bddc5fca36e55a3" as Address;
/** Production move relay reads this contract (v2 — unix timestamps, 8-field getGame). */
export const CHESS_GAME_V2 = "0xA576321eB523FFb1e5FE568b317F9E7a7374fDdf" as Address;
export const CHESS_TOKEN_V2 = "0x607590fC7ba3F17b6B3274fF281528a131E9b015" as Address;

const CHESS_GAME_ABI = [
  {
    type: "function",
    name: "createGame",
    stateMutability: "nonpayable",
    inputs: [{ name: "wager", type: "uint256" }],
    outputs: [{ name: "gameId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelGame",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "joinGame",
    stateMutability: "nonpayable",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getGame",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "white", type: "address" },
          { name: "black", type: "address" },
          { name: "wager", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "result", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "joinedAt", type: "uint256" },
          { name: "drawProposer", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "canJoin",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "gameNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "GameCreated",
    inputs: [
      { name: "gameId", type: "uint256", indexed: true },
      { name: "white", type: "address", indexed: true },
      { name: "wager", type: "uint256", indexed: false },
    ],
  },
] as const;

const CHESS_GAME_ABI_V1_GET = [
  {
    type: "function",
    name: "getGame",
    stateMutability: "view",
    inputs: [{ name: "gameId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "white", type: "address" },
          { name: "black", type: "address" },
          { name: "wager", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "result", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "drawProposer", type: "address" },
        ],
      },
    ],
  },
] as const;

function isV1GameContract(game: Address): boolean {
  return game.toLowerCase() === CHESS_GAME_V1.toLowerCase();
}

function getGameReadAbi(game: Address) {
  return isV1GameContract(game) ? CHESS_GAME_ABI_V1_GET : CHESS_GAME_ABI;
}

export interface OnchainGame {
  id: number;
  white: Address;
  black: Address;
  wager: bigint;
  status: number;
  result: number;
  createdAt: number;
}

export type ChainClients = ReturnType<typeof createChainClients>;

export function createChainClients(privateKey: Hex, rpcUrl: string) {
  const token = (process.env.CHESS_TOKEN ?? CHESS_TOKEN_V2) as Address;
  const game = (process.env.CHESS_GAME ?? CHESS_GAME_V2) as Address;
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: celo, transport });
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport,
  });
  return {
    publicClient,
    walletClient,
    account: account.address,
    signer: account,
    token,
    game,
  };
}

export async function ensureChessBankroll(clients: ChainClients): Promise<void> {
  const { publicClient, walletClient, account, signer, token, game } = clients;
  const balance = await publicClient.readContract({
    address: token,
    abi: CHESS_TOKEN_ABI,
    functionName: "balanceOf",
    args: [account],
  });
  const minBalance = parseUnits("200", TOKEN_DECIMALS);
  if (balance < minBalance) {
    const cooldown = await publicClient.readContract({
      address: token,
      abi: CHESS_TOKEN_ABI,
      functionName: "faucetCooldownRemaining",
      args: [account],
    });
    if (cooldown > 0n) {
      console.log(`[chain] faucet cooldown ${cooldown}s — balance ${balance}`);
    } else {
      console.log("[chain] claiming CHESS faucet…");
      const hash = await walletClient.writeContract({
        account: signer,
        address: token,
        abi: CHESS_TOKEN_ABI,
        functionName: "faucetClaim",
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const allowance = await publicClient.readContract({
    address: token,
    abi: CHESS_TOKEN_ABI,
    functionName: "allowance",
    args: [account, game],
  });
  const floor = parseUnits("1000", TOKEN_DECIMALS);
  if (allowance < floor) {
    console.log("[chain] approving CHESS for game contract…");
    const hash = await walletClient.writeContract({
      account: signer,
      address: token,
      abi: CHESS_TOKEN_ABI,
      functionName: "approve",
      args: [game, parseUnits("1000000", TOKEN_DECIMALS)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function readGame(
  clients: ChainClients,
  gameId: number,
): Promise<OnchainGame> {
  const g = await clients.publicClient.readContract({
    address: clients.game,
    abi: getGameReadAbi(clients.game),
    functionName: "getGame",
    args: [BigInt(gameId)],
  });
  return {
    id: gameId,
    white: g.white,
    black: g.black,
    wager: g.wager,
    status: Number(g.status),
    result: Number(g.result),
    createdAt: Number(g.createdAt),
  };
}

export const JOIN_WINDOW_SECS = 600;
/** Mainnet v1 stores `createdAt` as block number; join window ≈ 17280 blocks. */
export const JOIN_WINDOW_BLOCKS = 17_280;

function isZeroAddress(a: Address): boolean {
  return a.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

/** Heuristic: values below 1e9 are block heights, not unix timestamps. */
export function createdAtUsesBlocks(createdAt: number): boolean {
  return createdAt > 0 && createdAt < 1_000_000_000;
}

/** Join window open and game waiting. */
export function isLobbyJoinable(
  game: OnchainGame,
  opts?: { nowSecs?: number; currentBlock?: bigint },
): boolean {
  if (game.status !== GameStatus.Waiting) return false;
  if (isZeroAddress(game.white)) return false;

  if (createdAtUsesBlocks(game.createdAt)) {
    if (opts?.currentBlock == null) return true; // caller should pass block when possible
    const ageBlocks = Number(opts.currentBlock - BigInt(game.createdAt));
    return ageBlocks >= 0 && ageBlocks <= JOIN_WINDOW_BLOCKS;
  }

  const now = opts?.nowSecs ?? Math.floor(Date.now() / 1000);
  return now - game.createdAt <= JOIN_WINDOW_SECS;
}

export async function isLobbyJoinableOnChain(
  clients: ChainClients,
  game: OnchainGame,
): Promise<boolean> {
  if (createdAtUsesBlocks(game.createdAt)) {
    const block = await clients.publicClient.getBlockNumber();
    return isLobbyJoinable(game, { currentBlock: block });
  }
  return isLobbyJoinable(game);
}

async function readCanJoin(clients: ChainClients, gameId: number): Promise<boolean> {
  try {
    return await clients.publicClient.readContract({
      address: clients.game,
      abi: CHESS_GAME_ABI,
      functionName: "canJoin",
      args: [BigInt(gameId)],
    });
  } catch {
    const game = await readGame(clients, gameId);
    return isLobbyJoinableOnChain(clients, game);
  }
}

export interface BotLobbyTarget {
  gameId: number;
  botName: string;
  targetRating: number;
  wagerWhole: number;
}

export async function findJoinableBotLobby(
  clients: ChainClients,
  opts: { maxWagerWhole: number; minElo: number; maxElo: number },
): Promise<BotLobbyTarget | null> {
  const nonce = (await clients.publicClient.readContract({
    address: clients.game,
    abi: CHESS_GAME_ABI,
    functionName: "gameNonce",
  })) as bigint;
  const lastId = Number(nonce) - 1;
  if (lastId < 0) return null;

  const candidates: BotLobbyTarget[] = [];
  for (let id = lastId; id >= Math.max(0, lastId - 24); id--) {
    let game: OnchainGame;
    try {
      game = await readGame(clients, id);
    } catch {
      continue;
    }
    if (!(await readCanJoin(clients, id)) && !(await isLobbyJoinableOnChain(clients, game))) {
      continue;
    }
    if (game.status !== GameStatus.Waiting) continue;
    if (!isFleetBotAddress(game.white)) continue;

    const bot = fleetBotByAddress(game.white);
    if (!bot) continue;

    const wagerWhole = Number(game.wager) / 10 ** TOKEN_DECIMALS;
    if (wagerWhole > opts.maxWagerWhole) continue;
    if (bot.targetRating < opts.minElo || bot.targetRating > opts.maxElo) continue;

    candidates.push({
      gameId: id,
      botName: bot.name,
      targetRating: bot.targetRating,
      wagerWhole,
    });
  }

  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export async function joinGame(clients: ChainClients, gameId: number): Promise<void> {
  const hash = await clients.walletClient.writeContract({
    account: clients.signer,
    address: clients.game,
    abi: CHESS_GAME_ABI,
    functionName: "joinGame",
    args: [BigInt(gameId)],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
}

export function didAgentWin(
  game: OnchainGame,
  agent: Address,
): "won" | "lost" | "draw" | "unknown" {
  if (game.status !== GameStatus.Finished && game.status !== GameStatus.Draw) {
    return "unknown";
  }
  const isWhite = game.white.toLowerCase() === agent.toLowerCase();
  const isBlack = game.black.toLowerCase() === agent.toLowerCase();
  if (!isWhite && !isBlack) return "unknown";
  // result: 1 WhiteWins, 2 BlackWins, 3 DrawResult
  if (game.result === 3) return "draw";
  if (game.result === 1) return isWhite ? "won" : "lost";
  if (game.result === 2) return isBlack ? "won" : "lost";
  return "unknown";
}

export function sideToMove(game: OnchainGame, moveCount: number): Address {
  return moveCount % 2 === 0 ? game.white : game.black;
}

export { CHESS_GAME_ABI, CHESS_TOKEN_ABI };
