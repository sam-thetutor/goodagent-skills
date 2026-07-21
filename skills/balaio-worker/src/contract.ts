import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

export const BALAIO_TASKS_V2 = "0xe60aa33E8Dee3Bb1B2218bF025AcB624312D519E" as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const balaioAbi = [
  {
    type: "function",
    name: "createTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_taskId", type: "string" },
      { name: "_token", type: "address" },
      { name: "_rewardPerSlot", type: "uint256" },
      { name: "_totalSlots", type: "uint256" },
      { name: "_approver", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approveTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_taskId", type: "string" },
      { name: "_claimant", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimTask",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_taskId", type: "string" },
      { name: "_proofHash", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimReward",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getAvailableSlots",
    stateMutability: "view",
    inputs: [{ name: "_taskId", type: "string" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "_taskId", type: "string" }],
    outputs: [
      {
        components: [
          { name: "taskId", type: "string" },
          { name: "creator", type: "address" },
          { name: "approver", type: "address" },
          { name: "token", type: "address" },
          { name: "rewardPerSlot", type: "uint256" },
          { name: "totalSlots", type: "uint256" },
          { name: "claimedSlots", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint256" },
          { name: "approvedSlots", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "getTaskSlot",
    stateMutability: "view",
    inputs: [
      { name: "_taskId", type: "string" },
      { name: "_claimant", type: "address" },
    ],
    outputs: [
      {
        components: [
          { name: "claimant", type: "address" },
          { name: "reward", type: "uint256" },
          { name: "claimed", type: "bool" },
          { name: "submitted", type: "bool" },
          { name: "approved", type: "bool" },
          { name: "withdrawn", type: "bool" },
        ],
        type: "tuple",
      },
    ],
  },
] as const;

export type OnChainTask = {
  taskId: string;
  creator: Address;
  approver: Address;
  token: Address;
  rewardPerSlot: bigint;
  totalSlots: bigint;
  claimedSlots: bigint;
  active: boolean;
  createdAt: bigint;
  approvedSlots: bigint;
};

export type TaskSlot = {
  claimant: Address;
  reward: bigint;
  claimed: boolean;
  submitted: boolean;
  approved: boolean;
  withdrawn: boolean;
};

export function makeBalaioClients(
  privateKey: Hex,
  rpcUrl: string,
  contract: Address = BALAIO_TASKS_V2,
) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  return {
    account,
    contract,
    public: createPublicClient({ chain: celo, transport }),
    wallet: createWalletClient({ account, chain: celo, transport }),
  };
}

export type BalaioClients = ReturnType<typeof makeBalaioClients>;

export async function readTaskSlot(
  clients: BalaioClients,
  taskId: string,
  claimant: Address,
): Promise<TaskSlot> {
  const slot = await clients.public.readContract({
    address: clients.contract,
    abi: balaioAbi,
    functionName: "getTaskSlot",
    args: [taskId, claimant],
  });
  return {
    claimant: slot.claimant,
    reward: slot.reward,
    claimed: slot.claimed,
    submitted: slot.submitted,
    approved: slot.approved,
    withdrawn: slot.withdrawn,
  };
}

export async function readTask(
  clients: BalaioClients,
  taskId: string,
): Promise<OnChainTask | null> {
  try {
    const task = await clients.public.readContract({
      address: clients.contract,
      abi: balaioAbi,
      functionName: "getTask",
      args: [taskId],
    });
    return {
      taskId: task.taskId,
      creator: task.creator,
      approver: task.approver,
      token: task.token,
      rewardPerSlot: task.rewardPerSlot,
      totalSlots: task.totalSlots,
      claimedSlots: task.claimedSlots,
      active: task.active,
      createdAt: task.createdAt,
      approvedSlots: task.approvedSlots,
    };
  } catch {
    return null;
  }
}

export async function readTokenBalance(
  clients: BalaioClients,
  token: Address,
  account: Address = clients.account.address,
): Promise<bigint> {
  return clients.public.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}

export async function ensureTokenAllowance(
  clients: BalaioClients,
  token: Address,
  required: bigint,
  dryRun: boolean,
): Promise<Hex | null> {
  const allowance = await clients.public.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [clients.account.address, clients.contract],
  });
  if (allowance >= required) return null;

  if (dryRun) {
    console.log(
      `[dry-run] would approve ${token} for ${required.toString()} (current allowance ${allowance.toString()})`,
    );
    return null;
  }

  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [clients.contract, maxUint256],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  console.log(`[approve] token=${token} tx=${hash}`);
  return hash;
}

export async function createTaskOnChain(
  clients: BalaioClients,
  taskId: string,
  token: Address,
  rewardPerSlot: bigint,
  totalSlots: bigint,
  approver: Address,
  dryRun: boolean,
): Promise<Hex | null> {
  if (dryRun) {
    console.log(
      `[dry-run] would createTask id=${taskId} token=${token} rewardPerSlot=${rewardPerSlot.toString()} slots=${totalSlots.toString()} approver=${approver}`,
    );
    return null;
  }

  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: clients.contract,
    abi: balaioAbi,
    functionName: "createTask",
    args: [taskId, token, rewardPerSlot, totalSlots, approver],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  return hash;
}

export async function approveTaskOnChain(
  clients: BalaioClients,
  taskId: string,
  claimant: Address,
  dryRun: boolean,
): Promise<Hex | null> {
  if (dryRun) {
    console.log(
      `[dry-run] would approveTask id=${taskId} claimant=${claimant}`,
    );
    return null;
  }

  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: clients.contract,
    abi: balaioAbi,
    functionName: "approveTask",
    args: [taskId, claimant],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  return hash;
}

export async function readAvailableSlots(
  clients: BalaioClients,
  taskId: string,
): Promise<bigint> {
  return clients.public.readContract({
    address: clients.contract,
    abi: balaioAbi,
    functionName: "getAvailableSlots",
    args: [taskId],
  });
}

export async function claimTask(
  clients: BalaioClients,
  taskId: string,
): Promise<Hex> {
  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: clients.contract,
    abi: balaioAbi,
    functionName: "claimTask",
    args: [taskId],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  return hash;
}

export async function submitTask(
  clients: BalaioClients,
  taskId: string,
  proofHash: string,
): Promise<Hex> {
  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: clients.contract,
    abi: balaioAbi,
    functionName: "submitTask",
    args: [taskId, proofHash],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  return hash;
}

export async function claimReward(
  clients: BalaioClients,
  taskId: string,
): Promise<Hex> {
  const hash = await clients.wallet.writeContract({
    chain: celo,
    address: clients.contract,
    abi: balaioAbi,
    functionName: "claimReward",
    args: [taskId],
  });
  await clients.public.waitForTransactionReceipt({ hash });
  return hash;
}
