import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
} from "viem";
import { celo } from "viem/chains";

/* GoodDollar core contracts on Celo mainnet. */
export const UBI_SCHEME = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1" as const;
export const IDENTITY = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42" as const;
const G_DOLLAR_DECIMALS = 18;

const ubiAbi = [
  {
    type: "function",
    name: "checkEntitlement",
    stateMutability: "view",
    inputs: [{ name: "member", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentDay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "dailyUbi",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDailyStats",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "claimers", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "lastClaimed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "periodStart",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const identityAbi = [
  {
    type: "function",
    name: "isWhitelisted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "identities",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "dateAuthenticated", type: "uint256" },
      { name: "dateAdded", type: "uint256" },
      { name: "did", type: "string" },
      { name: "whitelistedOnChainId", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "authenticationPeriod",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function makeClient() {
  return createPublicClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
  });
}

type CeloClient = ReturnType<typeof makeClient>;

let client: CeloClient | null = null;

export function chainClient(): CeloClient {
  if (!client) {
    client = makeClient();
  }
  return client;
}

export function fmtGs(raw: bigint, digits = 2): string {
  const value = Number(formatUnits(raw, G_DOLLAR_DECIMALS));
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export interface WalletSnapshot {
  wallet: Address;
  isWhitelisted: boolean;
  /** Unclaimed entitlement for today (0 if already claimed or not verified). */
  entitlement: bigint;
  eligible: boolean;
  /** Unix seconds of the last on-chain claim (0 = never). */
  lastClaimedAt: number;
  /** Unix seconds when face verification was last done (0 = unknown). */
  dateAuthenticated: number;
}

/**
 * One multicall pass over all wallets: entitlement + whitelist + lastClaimed +
 * identity row. Failed reads degrade to "not eligible" so one bad wallet never
 * breaks the whole scan.
 */
export async function readWallets(
  wallets: string[],
): Promise<WalletSnapshot[]> {
  if (wallets.length === 0) return [];
  const accounts = wallets.map((w) => getAddress(w));
  const c = chainClient();

  const results = await c.multicall({
    contracts: accounts.flatMap((account) => [
      {
        address: UBI_SCHEME,
        abi: ubiAbi,
        functionName: "checkEntitlement" as const,
        args: [account] as const,
      },
      {
        address: IDENTITY,
        abi: identityAbi,
        functionName: "isWhitelisted" as const,
        args: [account] as const,
      },
      {
        address: UBI_SCHEME,
        abi: ubiAbi,
        functionName: "lastClaimed" as const,
        args: [account] as const,
      },
      {
        address: IDENTITY,
        abi: identityAbi,
        functionName: "identities" as const,
        args: [account] as const,
      },
    ]),
    allowFailure: true,
  });

  return accounts.map((wallet, i) => {
    const [ent, wl, lc, idRow] = results.slice(i * 4, i * 4 + 4);
    const entitlement = ent.status === "success" ? (ent.result as bigint) : 0n;
    const isWhitelisted = wl.status === "success" && (wl.result as boolean);
    const lastClaimedAt =
      lc.status === "success" ? Number(lc.result as bigint) : 0;
    const dateAuthenticated =
      idRow.status === "success"
        ? Number((idRow.result as readonly [bigint, bigint, string, bigint, number])[0])
        : 0;
    return {
      wallet,
      isWhitelisted,
      entitlement,
      eligible: isWhitelisted && entitlement > 0n,
      lastClaimedAt,
      dateAuthenticated,
    };
  });
}

export interface PoolStats {
  /** UBIScheme day counter (increments at 12:00 UTC). */
  currentDay: string;
  /** Humans who claimed so far today. */
  claimersToday: number;
  /** G$ distributed so far today (formatted). */
  distributedTodayGs: string;
  /** Today's per-person claim amount (formatted). */
  dailyUbiGs: string;
  /** Unix seconds when the current UBI day started. */
  dayStart: number;
}

export async function readPoolStats(): Promise<PoolStats> {
  const c = chainClient();
  const [day, stats, daily, periodStart] = await Promise.all([
    c.readContract({ address: UBI_SCHEME, abi: ubiAbi, functionName: "currentDay" }),
    c.readContract({ address: UBI_SCHEME, abi: ubiAbi, functionName: "getDailyStats" }),
    c.readContract({ address: UBI_SCHEME, abi: ubiAbi, functionName: "dailyUbi" }),
    c.readContract({ address: UBI_SCHEME, abi: ubiAbi, functionName: "periodStart" }),
  ]);

  const dayNum = Number(day);
  return {
    currentDay: day.toString(),
    claimersToday: Number(stats[0]),
    distributedTodayGs: fmtGs(stats[1], 0),
    dailyUbiGs: fmtGs(daily),
    dayStart: Number(periodStart) + dayNum * 86_400,
  };
}

/** Face-verification authentication period in days (on-chain setting). */
export async function readAuthPeriodDays(): Promise<number> {
  const period = await chainClient().readContract({
    address: IDENTITY,
    abi: identityAbi,
    functionName: "authenticationPeriod",
  });
  return Number(period);
}
