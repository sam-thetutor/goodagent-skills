import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import { registerSubmission } from "./api.js";
import {
  claimReward,
  claimTask,
  readAvailableSlots,
  readTaskSlot,
  submitTask,
  type BalaioClients,
} from "./contract.js";
import type { BalaioTask } from "./discover.js";
import type { CreatedTaskRecord } from "./creator.js";
import { reportTaskEvent } from "./reporter.js";

type PendingTask = {
  taskId: string;
  token: string;
  reward: number;
  claimedAt: string;
  submittedAt?: string;
  proofLink?: string;
};

type WorkerState = {
  pending: PendingTask[];
  completed: string[];
  created: CreatedTaskRecord[];
};

const STATE_FILE = resolve(process.cwd(), "state.json");

function loadState(): WorkerState {
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as WorkerState;
    return {
      pending: parsed.pending ?? [],
      completed: parsed.completed ?? [],
      created: parsed.created ?? [],
    };
  } catch {
    return { pending: [], completed: [], created: [] };
  }
}

function saveState(state: WorkerState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function buildProofLink(agentAddress: Address, task: BalaioTask): string {
  const base =
    process.env.GOODAGENT_VERIFY_BASE?.trim() ??
    `https://goodagentids.xyz/verify?agent=${agentAddress}`;
  const taskParam = `task=${encodeURIComponent(task.id)}`;
  if (base.endsWith("agent=")) {
    return `${base}${agentAddress}&${taskParam}`;
  }
  if (base.includes("=")) return base;
  return `${base.replace(/\/$/, "")}?agent=${agentAddress}&${taskParam}`;
}

function buildDeliverable(agentAddress: Address, task: BalaioTask): string {
  const proofLink = buildProofLink(agentAddress, task);
  const customProof = process.env.WORKER_PROOF_URL?.trim();
  if (customProof) {
    return [
      `Delivery for Balaio task "${task.id}"`,
      "",
      `Title: ${task.title}`,
      "",
      `Proof link: ${customProof}`,
      `Worker: ${agentAddress}`,
    ].join("\n");
  }
  const description = task.description?.trim() || task.title;
  return [
    `GoodAgent delivery for Balaio task "${task.id}"`,
    "",
    `Title: ${task.title}`,
    "",
    "Work summary:",
    description.slice(0, 1200),
    "",
    `Verified agent: ${agentAddress}`,
    `Live verification: ${proofLink}`,
  ].join("\n");
}

export async function settleApprovedRewards(
  clients: BalaioClients,
  state: WorkerState,
): Promise<void> {
  const remaining: PendingTask[] = [];

  for (const pending of state.pending) {
    const slot = await readTaskSlot(clients, pending.taskId, clients.account.address);
    if (slot.withdrawn) {
      state.completed.push(pending.taskId);
      continue;
    }
    if (slot.approved && !slot.withdrawn) {
      const txHash = await claimReward(clients, pending.taskId);
      console.log(`[reward] task=${pending.taskId} tx=${txHash}`);
      reportTaskEvent({
        taskId: pending.taskId,
        action: "rewarded",
        reward: pending.reward,
        token: pending.token,
        txHash,
      });
      state.completed.push(pending.taskId);
      continue;
    }
    remaining.push(pending);
  }

  state.pending = remaining;
}

export async function workTask(
  clients: BalaioClients,
  task: BalaioTask,
  state: WorkerState,
  apiBase: string,
): Promise<boolean> {
  if (state.completed.includes(task.id)) return false;
  if (state.pending.some((p) => p.taskId === task.id)) return false;

  const available = await readAvailableSlots(clients, task.id);
  if (available <= 0n) {
    console.log(`[scan] skip ${task.id} — no slots`);
    return false;
  }

  const existing = await readTaskSlot(clients, task.id, clients.account.address);
  if (existing.claimed || existing.submitted || existing.approved) {
    console.log(`[scan] skip ${task.id} — already engaged`);
    return false;
  }

  const claimTx = await claimTask(clients, task.id);
  console.log(`[claim] task=${task.id} reward=${task.reward} ${task.token} tx=${claimTx}`);
  reportTaskEvent({
    taskId: task.id,
    action: "claimed",
    reward: task.reward,
    token: task.token,
    txHash: claimTx,
  });

  const proofLink = buildProofLink(clients.account.address, task);
  const customProof = process.env.WORKER_PROOF_URL?.trim();
  const submissionLink = customProof ?? proofLink;
  const deliverable = buildDeliverable(clients.account.address, task);
  const proofHash = customProof ?? (deliverable.length > 180 ? proofLink : deliverable);

  const submitTx = await submitTask(clients, task.id, proofHash);
  console.log(`[submit] task=${task.id} tx=${submitTx}`);
  reportTaskEvent({
    taskId: task.id,
    action: "submitted",
    reward: task.reward,
    token: task.token,
    txHash: submitTx,
  });

  try {
    await registerSubmission(
      apiBase,
      task.id,
      clients.account.address,
      submissionLink,
    );
  } catch (error) {
    console.warn(
      `[submit] api mirror failed for ${task.id}: ${(error as Error).message}`,
    );
  }

  state.pending.push({
    taskId: task.id,
    token: task.token,
    reward: task.reward,
    claimedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    proofLink,
  });
  return true;
}

export function getWorkerState(): WorkerState {
  return loadState();
}

export function persistWorkerState(state: WorkerState): void {
  saveState(state);
}
