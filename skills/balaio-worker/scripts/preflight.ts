#!/usr/bin/env tsx
/**
 * CLI preflight — validates env + balances without sending transactions.
 * Usage: npm run preflight
 */
import { config as loadEnv } from "dotenv";
import { formatUnits, getAddress, isAddress, type Hex } from "viem";
import { estimateCreateEscrowGs, loadRuntimeConfig } from "../src/config.js";
import {
  BALAIO_TASKS_V2,
  makeBalaioClients,
  readTask,
  readTokenBalance,
} from "../src/contract.js";
import { computeCreationDeposit, parseRewardAmount, resolveToken } from "../src/tokens.js";

loadEnv();

async function main(): Promise<void> {
  process.env.DRY_RUN = "1";

  const privateKeyRaw = process.env.PRIVATE_KEY?.trim();
  if (!privateKeyRaw) {
    console.error("[fatal] PRIVATE_KEY is not set");
    process.exit(1);
  }
  const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as Hex;
  const { privateKeyToAccount } = await import("viem/accounts");
  const derived = privateKeyToAccount(privateKey).address;
  const agentAddress =
    process.env.AGENT_ADDRESS?.trim() && isAddress(process.env.AGENT_ADDRESS)
      ? getAddress(process.env.AGENT_ADDRESS)
      : derived;

  const runtime = loadRuntimeConfig(agentAddress);
  const rpcUrl = process.env.CELO_RPC_URL?.trim() ?? "https://forno.celo.org";
  const contract = getAddress(process.env.BALAIO_CONTRACT?.trim() ?? BALAIO_TASKS_V2);
  const clients = makeBalaioClients(privateKey, rpcUrl, contract);

  console.log("=== Balaio skill preflight ===");
  console.log(`agent:    ${agentAddress}`);
  console.log(`contract: ${contract}`);
  console.log(
    `roles:    worker=${runtime.enableWorker} create=${runtime.enableCreate} approve=${runtime.enableApprove}`,
  );

  const celoBalance = await clients.public.getBalance({ address: agentAddress });
  console.log(`CELO:     ${formatUnits(celoBalance, 18)}`);

  if (runtime.create) {
    const token = resolveToken(runtime.create.token);
    const rewardPerSlot = parseRewardAmount(runtime.create.reward, token.decimals);
    const deposit = computeCreationDeposit(rewardPerSlot, BigInt(runtime.create.slots));
    const balance = await readTokenBalance(clients, token.address, agentAddress);
    const existing = await readTask(clients, runtime.create.taskId);
    const escrowGs = estimateCreateEscrowGs(runtime.create);

    console.log("\n--- Creator task ---");
    console.log(`taskId:   ${runtime.create.taskId}`);
    console.log(`title:    ${runtime.create.title}`);
    console.log(`reward:   ${runtime.create.reward} ${token.symbol} × ${runtime.create.slots} slots`);
    console.log(`deposit:  ${formatUnits(deposit, token.decimals)} ${token.symbol} (~${escrowGs.toFixed(2)} G$ equiv)`);
    console.log(`balance:  ${formatUnits(balance, token.decimals)} ${token.symbol}`);
    console.log(`approver: ${runtime.create.approverAddress}`);
    console.log(`on-chain: ${existing ? "exists" : "not yet created"}`);

    const reserve = parseRewardAmount(runtime.create.minWalletReserveGs, token.decimals);
    if (balance < deposit + reserve) {
      console.error(
        `\n[FAIL] insufficient ${token.symbol} for create (need ${formatUnits(deposit + reserve, token.decimals)})`,
      );
      process.exit(1);
    }
    if (escrowGs > runtime.create.maxEscrowGs && token.symbol === "G$") {
      console.error(`\n[FAIL] escrow exceeds MAX_ESCROW_GS=${runtime.create.maxEscrowGs}`);
      process.exit(1);
    }
  }

  console.log("\n[OK] preflight passed — run with DRY_RUN=1 for a dry pass or unset DRY_RUN to go live");
}

void main().catch((error) => {
  console.error(`[fatal] ${(error as Error).message}`);
  process.exit(1);
});
