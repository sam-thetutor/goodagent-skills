import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseEventLogs,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { ARENA_ABI, ERC20_ABI } from "./abis.js";
import type { SkillConfig } from "./config.js";

export type ChainClients = ReturnType<typeof createChainClients>;

export function createChainClients(config: SkillConfig) {
  const signer = config.account;
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: celo, transport });
  const walletClient = createWalletClient({
    account: signer,
    chain: celo,
    transport,
  });
  return {
    publicClient,
    walletClient,
    signer,
    address: signer.address,
    arenaContract: config.arenaContract,
    usdtAddress: config.usdtAddress,
  };
}

export async function readStakeAmount(clients: ChainClients): Promise<bigint> {
  return clients.publicClient.readContract({
    address: clients.arenaContract,
    abi: ARENA_ABI,
    functionName: "stakeAmount",
  });
}

export async function readOnChainStatus(
  clients: ChainClients,
  tournamentId: number,
): Promise<number> {
  const t = await clients.publicClient.readContract({
    address: clients.arenaContract,
    abi: ARENA_ABI,
    functionName: "getTournament",
    args: [BigInt(tournamentId)],
  });
  return Number(t[4]);
}

export async function ensureUsdtStakeApproved(clients: ChainClients): Promise<bigint> {
  const stake = await readStakeAmount(clients);
  const bal = await clients.publicClient.readContract({
    address: clients.usdtAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [clients.address],
  });
  if (bal < stake) {
    throw new Error(
      `USDT balance too low: ${Number(bal) / 1e6} < stake ${Number(stake) / 1e6}`,
    );
  }
  const allowance = await clients.publicClient.readContract({
    address: clients.usdtAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [clients.address, clients.arenaContract],
  });
  if (allowance < stake) {
    console.log(`[chain] approving USDT ${Number(stake) / 1e6} for Arena`);
    const hash = await clients.walletClient.writeContract({
      account: clients.signer,
      chain: celo,
      address: clients.usdtAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [clients.arenaContract, maxUint256],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash });
  }
  return stake;
}

export async function openLobby(clients: ChainClients): Promise<number> {
  await ensureUsdtStakeApproved(clients);
  const hash = await clients.walletClient.writeContract({
    account: clients.signer,
    chain: celo,
    address: clients.arenaContract,
    abi: ARENA_ABI,
    functionName: "openLobby",
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({
    logs: receipt.logs,
    abi: ARENA_ABI,
    eventName: "LobbyOpened",
  });
  if (!ev) throw new Error("LobbyOpened event not found");
  return Number(ev.args.id);
}

export async function acceptLobby(
  clients: ChainClients,
  tournamentId: number,
): Promise<void> {
  await ensureUsdtStakeApproved(clients);
  const hash = await clients.walletClient.writeContract({
    account: clients.signer,
    chain: celo,
    address: clients.arenaContract,
    abi: ARENA_ABI,
    functionName: "acceptLobby",
    args: [BigInt(tournamentId)],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash });
}

export async function refundLobby(
  clients: ChainClients,
  tournamentId: number,
): Promise<Hex | null> {
  try {
    const hash = await clients.walletClient.writeContract({
      account: clients.signer,
      chain: celo,
      address: clients.arenaContract,
      abi: ARENA_ABI,
      functionName: "refundLobby",
      args: [BigInt(tournamentId)],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash });
    console.log(`[chain] refundLobby tx ${hash}`);
    return hash;
  } catch (err) {
    console.log(`[chain] refundLobby failed: ${(err as Error).message}`);
    return null;
  }
}

export async function refundLockedLobby(
  clients: ChainClients,
  tournamentId: number,
): Promise<Hex | null> {
  try {
    const hash = await clients.walletClient.writeContract({
      account: clients.signer,
      chain: celo,
      address: clients.arenaContract,
      abi: ARENA_ABI,
      functionName: "refundLockedLobby",
      args: [BigInt(tournamentId)],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash });
    console.log(`[chain] refundLockedLobby tx ${hash}`);
    return hash;
  } catch (err) {
    console.log(`[chain] refundLockedLobby failed: ${(err as Error).message}`);
    return null;
  }
}
