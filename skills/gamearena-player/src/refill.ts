import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { G_TOKEN_ADDRESS } from "./arena.js";
import type {
  BuyPerkGaslessResult,
  BuyPerkGaslessSig,
  RefillOffer,
} from "./challenge-ai.js";

/** GameArena PerkShop on Celo — Match Pack (perk 6) credits +5 challenge-ai tickets. */
export const PERK_SHOP_ADDRESS =
  "0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5" as const;

/** challenge-ai Match Pack: 2 G$ → +5 matches vs MARKOV. */
export const MATCH_PACK_PERK_ID = 6;

const SKU_TO_PERK_ID: Record<string, number> = {
  refill_5: MATCH_PACK_PERK_ID,
};

const tokenAbi = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function perkIdFromRefillOffer(offer: RefillOffer): number {
  return SKU_TO_PERK_ID[offer.sku] ?? MATCH_PACK_PERK_ID;
}

export async function readGsBalance(
  address: Address,
  rpcUrl: string,
  token: Address = G_TOKEN_ADDRESS,
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });
  return publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

/** @deprecated GameArena removed pool-wallet refills; use buyMatchPackGasless. */
export async function sendRefillPayment(
  privateKey: Hex,
  rpcUrl: string,
  offer: RefillOffer,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const token = offer.gToken ?? G_TOKEN_ADDRESS;
  const amount = parseEther(String(offer.priceGs));

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });

  const balance = await readGsBalance(account.address, rpcUrl, token);
  if (balance < amount) {
    throw new Error(
      `G$ balance too low for refill: need ${offer.priceGs} G$, have ${Number(balance) / 1e18}`,
    );
  }

  const hash = await walletClient.writeContract({
    address: token,
    abi: tokenAbi,
    functionName: "transfer",
    args: [offer.poolWallet, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}

/**
 * Buy challenge-ai Match Pack via GameArena relayer (EIP-712 G$ permit + buyPerkGasless).
 */
export async function buyMatchPackGasless(
  privateKey: Hex,
  rpcUrl: string,
  playerAddress: Address,
  buyPerkGasless: (sig: BuyPerkGaslessSig) => Promise<BuyPerkGaslessResult>,
  priceGs: number,
  perkId: number = MATCH_PACK_PERK_ID,
  gToken: Address = G_TOKEN_ADDRESS,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const amount = parseEther(String(priceGs));

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });

  const balance = await readGsBalance(playerAddress, rpcUrl, gToken);
  if (balance < amount) {
    throw new Error(
      `G$ balance too low for Match Pack: need ${priceGs} G$, have ${Number(balance) / 1e18}`,
    );
  }

  const nonce = await publicClient.readContract({
    address: gToken,
    abi: tokenAbi,
    functionName: "nonces",
    args: [playerAddress],
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await account.signTypedData({
    domain: {
      name: "GoodDollar",
      version: "1",
      chainId: celo.id,
      verifyingContract: gToken,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: playerAddress,
      spender: PERK_SHOP_ADDRESS,
      value: amount,
      nonce,
      deadline,
    },
  });

  const parsed = parseSignature(signature);
  const v =
    parsed.v !== undefined ? Number(parsed.v) : (parsed.yParity ?? 0) + 27;

  const result = await buyPerkGasless({
    perkId,
    deadline: deadline.toString(),
    v,
    r: parsed.r,
    s: parsed.s,
  });

  if (!result.ok || !result.txHash) {
    throw new Error(result.error ?? "buyPerkGasless failed");
  }

  return result.txHash;
}
