import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem/accounts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PlayMode = "auto" | "open" | "accept";
export type SolverEngine = "stockfish" | "basic";

export interface SkillConfig {
  account: LocalAccount;
  playerAddress: `0x${string}`;
  playerName: string;
  rpcUrl: string;
  arenaUrl: string;
  arenaContract: `0x${string}`;
  usdtAddress: `0x${string}`;
  autoSwap: boolean;
  minGsReserve: bigint;
  usdtStakeBuffer: bigint;
  playMode: PlayMode;
  solverEngine: SolverEngine;
  solverCmd?: string;
  solverMovetimeMs: number;
  maxMatches: number;
  dailyMatchCap: number;
  intervalMs: number;
}

const SKILL_ROOT = dirname(fileURLToPath(import.meta.url));

function bundledStockfishCmd(): string {
  return `node ${join(SKILL_ROOT, "..", "scripts", "stockfish-solver.mjs")}`;
}

function resolveSolverCmd(
  solverEngine: SolverEngine,
  solverCmdRaw: string | undefined,
): string | undefined {
  if (solverEngine === "basic") return undefined;
  if (solverCmdRaw) return solverCmdRaw;
  return bundledStockfishCmd();
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function parseBigInt(raw: string | undefined, fallback: bigint): bigint {
  if (!raw?.trim()) return fallback;
  return BigInt(raw.trim());
}

export function loadConfig(): SkillConfig {
  const privateKey = (process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY)?.trim() as
    | Hex
    | undefined;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY (or AGENT_PRIVATE_KEY) is required");
  }

  const account = privateKeyToAccount(privateKey);
  const playerAddress = (process.env.PLAYER_ADDRESS?.trim() || account.address) as `0x${string}`;
  if (playerAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("PLAYER_ADDRESS must match PRIVATE_KEY wallet");
  }

  const playModeRaw = (process.env.PLAY_MODE ?? "auto").trim().toLowerCase();
  const playMode: PlayMode =
    playModeRaw === "open" || playModeRaw === "accept" ? playModeRaw : "auto";

  const solverEngineRaw = (process.env.SOLVER_ENGINE ?? "stockfish")
    .trim()
    .toLowerCase();
  const solverEngine: SolverEngine =
    solverEngineRaw === "basic" ? "basic" : "stockfish";
  const solverCmd = resolveSolverCmd(
    solverEngine,
    process.env.SOLVER_CMD?.trim() || undefined,
  );
  const solverMovetimeMs = Math.max(
    100,
    Math.min(3000, Number(process.env.SOLVER_MOVETIME_MS ?? 450) || 450),
  );

  return {
    account,
    playerAddress,
    playerName: process.env.PLAYER_NAME?.trim() || "GoodAgent",
    rpcUrl: process.env.CELO_RPC_URL?.trim() || "https://forno.celo.org",
    arenaUrl: (process.env.ARENA_URL ?? "https://arena.chesspuzzles.xyz").replace(/\/$/, ""),
    arenaContract: (process.env.ARENA_CONTRACT ??
      "0x8fe68a574f0b8c2819897363195ed3d66fde4ec1") as `0x${string}`,
    usdtAddress: (process.env.USDT_ADDRESS ??
      "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e") as `0x${string}`,
    autoSwap: parseBool(process.env.AUTO_SWAP, true),
    minGsReserve: parseBigInt(process.env.MIN_GS_RESERVE, 50n * 10n ** 18n),
    usdtStakeBuffer: parseBigInt(process.env.USDT_STAKE_BUFFER, 1_000_000n),
    playMode,
    solverEngine,
    solverCmd,
    solverMovetimeMs,
    maxMatches: Math.max(0, Number(process.env.MAX_MATCHES ?? 5)),
    dailyMatchCap: Math.max(0, Number(process.env.DAILY_MATCH_CAP ?? 20)),
    intervalMs: Math.max(10, Number(process.env.MATCH_INTERVAL_SECONDS ?? 120)) * 1000,
  };
}
