import { config as loadEnv } from "dotenv";
import { getAddress, isAddress, type Hex } from "viem";
import { runApproverPass } from "./approver.js";
import { loadRuntimeConfig } from "./config.js";
import { runCreatorPass } from "./creator.js";
import { BALAIO_TASKS_V2, makeBalaioClients } from "./contract.js";
import { filterTasks, listOpenTasks, listTasksByIds } from "./discover.js";
import { installLogReporter } from "./reporter.js";
import {
  getWorkerState,
  persistWorkerState,
  settleApprovedRewards,
  workTask,
} from "./worker.js";

loadEnv();
installLogReporter();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[fatal] ${name} is not set`);
    process.exit(1);
  }
  return value;
}

function resolvePrivateKey(): Hex {
  const raw = requireEnv("PRIVATE_KEY");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function main(): Promise<void> {
  const privateKey = resolvePrivateKey();
  const { privateKeyToAccount } = await import("viem/accounts");
  const agentAddress =
    process.env.AGENT_ADDRESS?.trim() && isAddress(process.env.AGENT_ADDRESS)
      ? getAddress(process.env.AGENT_ADDRESS)
      : privateKeyToAccount(privateKey).address;

  const runtime = loadRuntimeConfig(agentAddress);
  const rpcUrl = process.env.CELO_RPC_URL?.trim() ?? "https://forno.celo.org";
  const contract = getAddress(
    process.env.BALAIO_CONTRACT?.trim() ?? BALAIO_TASKS_V2,
  );

  const clients = makeBalaioClients(privateKey, rpcUrl, contract);
  if (clients.account.address.toLowerCase() !== agentAddress.toLowerCase()) {
    console.error("[fatal] PRIVATE_KEY does not match AGENT_ADDRESS");
    process.exit(1);
  }

  const roles = [
    runtime.enableWorker && "worker",
    runtime.enableCreate && "creator",
    runtime.enableApprove && "approver",
  ]
    .filter(Boolean)
    .join("+");

  console.log(
    `[start] balaio-worker agent=${agentAddress} contract=${contract} roles=${roles}` +
      `${runtime.dryRun ? " dry-run=1" : ""}` +
      `${runtime.enableWorker ? ` scan=${runtime.scanSeconds}s minReward=${runtime.minReward}` : ""}` +
      `${runtime.create ? ` createTask=${runtime.create.taskId}` : ""}`,
  );

  async function runPass(): Promise<void> {
    const state = getWorkerState();

    if (runtime.enableCreate && runtime.create) {
      try {
        const created = await runCreatorPass(
          clients,
          runtime.create,
          runtime.apiBase,
          runtime.dryRun,
          state.created,
        );
        if (created) {
          state.created.push(created);
        }
      } catch (error) {
        console.error(`[error] create: ${(error as Error).message}`);
      }
    }

    if (runtime.enableApprove) {
      try {
        await runApproverPass(
          clients,
          state.created,
          runtime.approveTaskIds,
          runtime.dryRun,
        );
      } catch (error) {
        console.error(`[error] approve: ${(error as Error).message}`);
      }
    }

    if (runtime.enableWorker) {
      await settleApprovedRewards(clients, state);

      const taskSource =
        runtime.taskIds.length > 0
          ? await listTasksByIds(contract, runtime.taskIds)
          : await listOpenTasks(contract);
      const open = filterTasks(taskSource, {
        minReward: runtime.minReward,
        allowedTokens: runtime.allowedTokens,
        taskIds: runtime.taskIds,
      });
      console.log(`[scan] ${open.length} open task(s) after filters`);

      let worked = 0;
      for (const task of open) {
        if (worked >= runtime.maxTasksPerRun) break;
        try {
          const didWork = await workTask(clients, task, state, runtime.apiBase);
          if (didWork) worked += 1;
        } catch (error) {
          console.error(`[error] task=${task.id}: ${(error as Error).message}`);
        }
      }

      if (worked === 0) {
        console.log("[scan] no new claims this pass");
      }
    }

    persistWorkerState(state);
  }

  await runPass();

  if (process.env.RUN_ONCE === "1") {
    console.log("[run-once] single pass complete — exiting");
    return;
  }

  if (runtime.dryRun) {
    console.log("[dry-run] single pass complete — exiting (no interval loop)");
    return;
  }

  setInterval(() => {
    void runPass().catch((error) => {
      console.error(`[error] pass failed: ${(error as Error).message}`);
    });
  }, runtime.scanSeconds * 1000);
}

void main();
