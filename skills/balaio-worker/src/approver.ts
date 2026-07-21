import { getAddress, isAddress, type Address } from "viem";
import {
  approveTaskOnChain,
  readTaskSlot,
  type BalaioClients,
} from "./contract.js";
import type { CreatedTaskRecord } from "./creator.js";
import { reportTaskEvent } from "./reporter.js";

type TaskClaimRow = {
  task_id: string;
  worker_address: string;
  submitted_at: string | null;
  approved_at: string | null;
};

function supabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.BALAIO_SUPABASE_URL?.trim();
  const anonKey = process.env.BALAIO_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("BALAIO_SUPABASE_URL and BALAIO_SUPABASE_ANON_KEY must be set");
  }
  return { url: url.replace(/\/$/, ""), anonKey };
}

async function listSubmittedClaims(taskIds: string[]): Promise<TaskClaimRow[]> {
  if (taskIds.length === 0) return [];
  const { url, anonKey } = supabaseConfig();
  const params = new URLSearchParams({
    select: "task_id,worker_address,submitted_at,approved_at",
    task_id: `in.(${taskIds.join(",")})`,
    submitted_at: "not.is.null",
    order: "submitted_at.desc",
    limit: "25",
  });

  const res = await fetch(`${url}/rest/v1/task_claims?${params}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`supabase task_claims fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  return (await res.json()) as TaskClaimRow[];
}

function resolveApproveTaskIds(
  createdTasks: CreatedTaskRecord[],
  explicitIds: string[],
): string[] {
  const ids = new Set<string>();
  for (const id of explicitIds) ids.add(id);
  for (const task of createdTasks) ids.add(task.taskId);
  return [...ids];
}

export async function runApproverPass(
  clients: BalaioClients,
  createdTasks: CreatedTaskRecord[],
  explicitTaskIds: string[],
  dryRun: boolean,
): Promise<number> {
  const taskIds = resolveApproveTaskIds(createdTasks, explicitTaskIds);
  if (taskIds.length === 0) {
    console.log("[approve] no task IDs configured");
    return 0;
  }

  const claims = await listSubmittedClaims(taskIds);
  const extraWorkers = (process.env.APPROVE_WORKER_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => isAddress(a))
    .map((a) => getAddress(a));

  let approved = 0;

  async function tryApprove(taskId: string, claimant: Address): Promise<boolean> {
    const slot = await readTaskSlot(clients, taskId, claimant);
    if (!slot.submitted || slot.approved || slot.withdrawn) return false;
    const txHash = await approveTaskOnChain(clients, taskId, claimant, dryRun);
    console.log(`[approve] task=${taskId} claimant=${claimant} tx=${txHash ?? "dry-run"}`);
    reportTaskEvent({
      taskId,
      action: "approved",
      txHash: txHash ?? undefined,
    });
    return true;
  }

  for (const claim of claims) {
    if (claim.approved_at) continue;
    if (!isAddress(claim.worker_address)) continue;
    const claimant = getAddress(claim.worker_address);
    if (await tryApprove(claim.task_id, claimant)) approved += 1;
  }

  for (const taskId of taskIds) {
    for (const claimant of extraWorkers) {
      if (await tryApprove(taskId, claimant)) approved += 1;
    }
  }

  if (approved === 0) {
    console.log("[approve] no pending submissions to approve");
  }
  return approved;
}
