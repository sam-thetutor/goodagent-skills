import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { ClaimSignature, ProductClankApi } from "./api.js";
import type { RuntimeConfig } from "./config.js";
import type { SkillState } from "./state.js";

const CLAIM_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "fid", type: "uint256" },
      { name: "auctionId", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Minimum ETH on Base we require before attempting a claim tx. */
const MIN_GAS_WEI = 30_000_000_000_000n; // 0.00003 ETH

/**
 * Claim $PRO rewards on Base for approved submissions that have not been
 * claimed yet. Requires PRIVATE_KEY; silently skips when it is missing.
 */
export async function runProClaimPass(
  config: RuntimeConfig,
  api: ProductClankApi,
  state: SkillState,
): Promise<void> {
  const rawKey = process.env.PRIVATE_KEY?.trim();
  if (!rawKey) {
    console.log("[claim] PRIVATE_KEY not set — skipping $PRO claims");
    return;
  }
  const account = privateKeyToAccount(
    (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex,
  );

  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.baseRpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.baseRpcUrl),
  });

  const candidates = state.submissions.filter((s) => !s.rewardClaimed);
  if (candidates.length === 0) return;

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < MIN_GAS_WEI) {
    console.warn(
      `[claim] insufficient ETH for gas on Base (${formatEther(balance)} ETH at ${account.address}) — top up to claim $PRO`,
    );
    return;
  }

  for (const submission of candidates) {
    let sig: ClaimSignature;
    try {
      sig = await api.claimSignature(submission.replyId);
    } catch (error) {
      console.warn(
        `[claim] claim-signature request failed for ${submission.replyId}: ${(error as Error).message}`,
      );
      continue;
    }

    if (!sig.success || !sig.signature || !sig.claimData || !sig.contractAddress) {
      // Expected for pending/rejected/already-claimed submissions; only log
      // codes that need operator attention.
      if (sig.error === "already_claimed") {
        submission.rewardClaimed = true;
      } else if (sig.error && sig.error !== "not_eligible") {
        console.log(
          `[claim] ${submission.replyId}: ${sig.error} — ${sig.message ?? ""}`,
        );
      }
      continue;
    }

    if (config.dryRun) {
      console.log(
        `[claim] DRY_RUN — would claim ${sig.claimData.amount} PRO for ${submission.replyId}`,
      );
      continue;
    }

    try {
      const txHash = await walletClient.writeContract({
        address: sig.contractAddress,
        abi: CLAIM_ABI,
        functionName: "claim",
        args: [
          sig.claimData.token,
          sig.claimData.recipient,
          BigInt(sig.claimData.amount),
          BigInt(sig.claimData.fid),
          BigInt(sig.claimData.auctionId),
          BigInt(sig.claimData.deadline),
          sig.signature,
        ],
      });
      console.log(`[claim] claim tx sent for ${submission.replyId}: ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await api.recordClaim(submission.replyId, txHash);
      submission.rewardClaimed = true;
      submission.rewardTxHash = txHash;
      console.log(`[claim] $PRO claimed + recorded for ${submission.replyId}`);
    } catch (error) {
      console.warn(
        `[claim] on-chain claim failed for ${submission.replyId}: ${(error as Error).message}`,
      );
    }
  }
}
