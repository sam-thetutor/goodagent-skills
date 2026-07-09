import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

export const ARENA_ADDRESS =
  "0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE" as const;
export const G_TOKEN_ADDRESS =
  "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A" as const;
/** MARKOV's playing wallet (ERC-8004 agent #6386 on Celo). */
export const MARKOV_ADDRESS =
  "0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1" as const;

export const MatchStatus = {
  Proposed: 0,
  Accepted: 1,
  Completed: 2,
  Cancelled: 3,
} as const;

const arenaAbi = [
  {
    type: "event",
    name: "MatchProposed",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "opponent", type: "address", indexed: true },
      { name: "wager", type: "uint256", indexed: false },
      { name: "gameType", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "playMove",
    inputs: [
      { name: "_matchId", type: "uint256" },
      { name: "_move", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "matches",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "challenger", type: "address" },
      { name: "opponent", type: "address" },
      { name: "wager", type: "uint256" },
      { name: "gameType", type: "uint8" },
      { name: "status", type: "uint8" },
      { name: "winner", type: "address" },
      { name: "createdAt", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasPlayed",
    inputs: [
      { name: "_matchId", type: "uint256" },
      { name: "_player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "transferAndCall",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
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

export interface MatchState {
  id: bigint;
  challenger: Address;
  opponent: Address;
  wager: bigint;
  gameType: number;
  status: number;
  winner: Address;
}

export class ArenaClient {
  readonly account;
  private publicClient;
  private walletClient;

  constructor(privateKey: Hex, rpcUrl: string) {
    this.account = privateKeyToAccount(privateKey);
    this.publicClient = createPublicClient({
      chain: celo,
      transport: http(rpcUrl, { timeout: 30_000 }),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: celo,
      transport: http(rpcUrl, { timeout: 30_000 }),
    });
  }

  async balances(): Promise<{ gs: bigint; celo: bigint }> {
    const [gs, celoBal] = await Promise.all([
      this.publicClient.readContract({
        address: G_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.account.address],
      }),
      this.publicClient.getBalance({ address: this.account.address }),
    ]);
    return { gs, celo: celoBal };
  }

  /**
   * Propose a match via ERC-677 transferAndCall (escrows the wager in one tx).
   * Returns the matchId parsed from the MatchProposed event.
   */
  async proposeMatch(
    opponent: Address,
    gameType: number,
    wagerGs: string,
  ): Promise<bigint> {
    const data = encodeAbiParameters(
      [{ type: "uint8" }, { type: "address" }, { type: "uint8" }],
      [0, opponent, gameType],
    );
    const { request } = await this.publicClient.simulateContract({
      address: G_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "transferAndCall",
      args: [ARENA_ADDRESS, parseEther(wagerGs), data],
      account: this.account,
    });
    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ARENA_ADDRESS.toLowerCase()) continue;
      try {
        const event = decodeEventLog({
          abi: arenaAbi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "MatchProposed") {
          return event.args.matchId;
        }
      } catch {
        // Not a MatchProposed log; keep scanning.
      }
    }
    throw new Error(`MatchProposed event not found in tx ${hash}`);
  }

  async getMatch(matchId: bigint): Promise<MatchState> {
    const m = await this.publicClient.readContract({
      address: ARENA_ADDRESS,
      abi: arenaAbi,
      functionName: "matches",
      args: [matchId],
    });
    return {
      id: m[0],
      challenger: m[1],
      opponent: m[2],
      wager: m[3],
      gameType: m[4],
      status: m[5],
      winner: m[6],
    };
  }

  async hasPlayed(matchId: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: ARENA_ADDRESS,
      abi: arenaAbi,
      functionName: "hasPlayed",
      args: [matchId, this.account.address],
    });
  }

  async playMove(matchId: bigint, move: number): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address: ARENA_ADDRESS,
      abi: arenaAbi,
      functionName: "playMove",
      args: [matchId, move],
      account: this.account,
    });
    const hash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /** Poll a match until it reaches the given status (or timeout). */
  async waitForStatus(
    matchId: bigint,
    status: number,
    timeoutMs: number,
    pollMs = 10_000,
  ): Promise<MatchState | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await this.getMatch(matchId);
      if (m.status === status) return m;
      // A cancelled or completed match will never reach an earlier status.
      if (m.status > status) return m;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  }
}
