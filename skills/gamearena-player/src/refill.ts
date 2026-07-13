import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { G_TOKEN_ADDRESS } from "./arena.js";
import type { RefillOffer } from "./challenge-ai.js";

const transferAbi = [
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
] as const;

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
    abi: transferAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

/** Pay GameArena pool wallet for a ticket refill; returns tx hash. */
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
    abi: transferAbi,
    functionName: "transfer",
    args: [offer.poolWallet, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}
