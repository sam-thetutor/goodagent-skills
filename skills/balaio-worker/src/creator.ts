import { formatUnits, type Address } from "viem";
import { createTaskMetadata } from "./api.js";
import type { CreateTaskConfig } from "./config.js";
import {
  createTaskOnChain,
  ensureTokenAllowance,
  readTask,
  readTokenBalance,
  type BalaioClients,
} from "./contract.js";
import { reportTaskEvent } from "./reporter.js";
import {
  computeCreationDeposit,
  parseRewardAmount,
  resolveToken,
} from "./tokens.js";

export type CreatedTaskRecord = {
  taskId: string;
  reward: number;
  token: string;
  slots: number;
  approverAddress: Address;
  createdAt: string;
  metadataPosted?: boolean;
  approveTx?: string;
  createTx?: string;
};

export async function runCreatorPass(
  clients: BalaioClients,
  create: CreateTaskConfig,
  apiBase: string,
  dryRun: boolean,
  createdTasks: CreatedTaskRecord[],
): Promise<CreatedTaskRecord | null> {
  if (create.createOnce && createdTasks.some((t) => t.taskId === create.taskId)) {
    console.log(`[create] skip ${create.taskId} — already in local state`);
    return null;
  }

  const existing = await readTask(clients, create.taskId);
  if (existing && existing.createdAt > 0n) {
    console.log(`[create] skip ${create.taskId} — already on-chain`);
    return null;
  }

  const tokenInfo = resolveToken(create.token);
  const rewardPerSlot = parseRewardAmount(create.reward, tokenInfo.decimals);
  const totalSlots = BigInt(create.slots);
  const totalDeposit = computeCreationDeposit(rewardPerSlot, totalSlots);
  const depositHuman = Number(formatUnits(totalDeposit, tokenInfo.decimals));

  if (tokenInfo.symbol === "G$" && depositHuman > create.maxEscrowGs) {
    throw new Error(
      `create escrow ${depositHuman.toFixed(2)} G$ exceeds MAX_ESCROW_GS=${create.maxEscrowGs}`,
    );
  }

  const balance = await readTokenBalance(clients, tokenInfo.address);
  const reserve = parseRewardAmount(create.minWalletReserveGs, tokenInfo.decimals);
  if (balance < totalDeposit + reserve) {
    throw new Error(
      `insufficient ${tokenInfo.symbol}: need ${formatUnits(totalDeposit + reserve, tokenInfo.decimals)} ` +
        `(escrow ${formatUnits(totalDeposit, tokenInfo.decimals)} + reserve ${create.minWalletReserveGs}), ` +
        `have ${formatUnits(balance, tokenInfo.decimals)}`,
    );
  }

  console.log(
    `[create] task=${create.taskId} reward=${create.reward} ${tokenInfo.symbol}/slot ` +
      `slots=${create.slots} deposit=${formatUnits(totalDeposit, tokenInfo.decimals)} ${tokenInfo.symbol}`,
  );

  await createTaskMetadata(
    apiBase,
    {
      id: create.taskId,
      title: create.title,
      description: create.description,
      reward: String(create.reward),
      token: tokenInfo.symbol,
      tokenAddress: tokenInfo.address,
      creatorAddress: clients.account.address,
      slots: create.slots,
      visibility: create.visibility,
      approverAddress: create.approverAddress,
    },
    dryRun,
  );

  await ensureTokenAllowance(clients, tokenInfo.address, totalDeposit, dryRun);

  const createTx = await createTaskOnChain(
    clients,
    create.taskId,
    tokenInfo.address,
    rewardPerSlot,
    totalSlots,
    create.approverAddress,
    dryRun,
  );

  if (createTx) {
    console.log(`[create] on-chain task=${create.taskId} tx=${createTx}`);
    reportTaskEvent({
      taskId: create.taskId,
      action: "created",
      reward: create.reward,
      token: tokenInfo.symbol,
      txHash: createTx,
    });
  }

  const record: CreatedTaskRecord = {
    taskId: create.taskId,
    reward: create.reward,
    token: tokenInfo.symbol,
    slots: create.slots,
    approverAddress: create.approverAddress,
    createdAt: new Date().toISOString(),
    metadataPosted: true,
    createTx: createTx ?? undefined,
  };
  return record;
}
