import { getAddress, isAddress, type Address } from "viem";
import { computeCreationDeposit, parseRewardAmount, resolveToken } from "./tokens.js";

export type CreateTaskConfig = {
  taskId: string;
  title: string;
  description: string;
  reward: number;
  slots: number;
  token: string;
  visibility: string;
  approverAddress: Address;
  maxEscrowGs: number;
  minWalletReserveGs: number;
  createOnce: boolean;
};

export type BalaioRuntimeConfig = {
  enableWorker: boolean;
  enableCreate: boolean;
  enableApprove: boolean;
  dryRun: boolean;
  scanSeconds: number;
  minReward: number;
  maxTasksPerRun: number;
  allowedTokens: string[];
  taskIds: string[];
  approveTaskIds: string[];
  apiBase: string;
  create?: CreateTaskConfig;
};

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes";
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim() ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function parseCreateConfig(agentAddress: Address): CreateTaskConfig | undefined {
  if (!envFlag("ENABLE_CREATE")) return undefined;

  const taskId = process.env.CREATE_TASK_ID?.trim();
  const title = process.env.CREATE_TITLE?.trim();
  if (!taskId || !title) {
    throw new Error("ENABLE_CREATE=1 requires CREATE_TASK_ID and CREATE_TITLE");
  }

  const reward = envNumber("CREATE_REWARD", 0);
  const slots = Math.max(1, Math.floor(envNumber("CREATE_SLOTS", 1)));
  const token = process.env.CREATE_TOKEN?.trim() || "G$";
  const approverRaw = process.env.APPROVER_ADDRESS?.trim() || agentAddress;
  if (!isAddress(approverRaw)) {
    throw new Error(`invalid APPROVER_ADDRESS: ${approverRaw}`);
  }

  return {
    taskId,
    title,
    description: process.env.CREATE_DESCRIPTION?.trim() ?? "",
    reward,
    slots,
    token,
    visibility: process.env.CREATE_VISIBILITY?.trim() || "public",
    approverAddress: getAddress(approverRaw),
    maxEscrowGs: envNumber("MAX_ESCROW_GS", 500),
    minWalletReserveGs: envNumber("MIN_WALLET_RESERVE_GS", 10),
    createOnce: envFlag("CREATE_ONCE", true),
  };
}

export function loadRuntimeConfig(agentAddress: Address): BalaioRuntimeConfig {
  const create = parseCreateConfig(agentAddress);
  const enableCreate = envFlag("ENABLE_CREATE");
  const enableWorker = envFlag("ENABLE_WORKER", true);
  const enableApprove = envFlag("ENABLE_APPROVE");

  if (!enableWorker && !enableCreate && !enableApprove) {
    throw new Error(
      "at least one of ENABLE_WORKER, ENABLE_CREATE, or ENABLE_APPROVE must be enabled",
    );
  }

  return {
    enableWorker,
    enableCreate,
    enableApprove,
    dryRun: envFlag("DRY_RUN"),
    scanSeconds: Math.max(60, envNumber("SCAN_INTERVAL_SECONDS", 300)),
    minReward: Math.max(0, envNumber("MIN_REWARD", 1)),
    maxTasksPerRun: Math.max(1, envNumber("MAX_TASKS_PER_RUN", 1)),
    allowedTokens: (process.env.REWARD_TOKENS ?? "G$,USDC,CELO,cUSD")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    taskIds: (process.env.TASK_IDS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    approveTaskIds: (process.env.APPROVE_TASK_IDS ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    apiBase: process.env.BALAIO_API_BASE?.trim() ?? "https://www.usebalaio.com",
    create,
  };
}

export function estimateCreateEscrowGs(create: CreateTaskConfig): number {
  const token = resolveToken(create.token);
  const rewardPerSlot = parseRewardAmount(create.reward, token.decimals);
  const deposit = computeCreationDeposit(rewardPerSlot, BigInt(create.slots));
  if (token.decimals === 18) {
    return Number(deposit) / 1e18;
  }
  if (token.decimals === 6) {
    return Number(deposit) / 1e6;
  }
  return create.reward * create.slots * 1.02;
}
