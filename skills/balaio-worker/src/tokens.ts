import { type Address, parseUnits } from "viem";

export type TokenInfo = {
  symbol: string;
  address: Address;
  decimals: number;
};

/** Supported reward tokens on Balaio (Celo mainnet). */
const TOKENS: Record<string, TokenInfo> = {
  G$: {
    symbol: "G$",
    address: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    decimals: 18,
  },
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
  },
  CUSD: {
    symbol: "cUSD",
    address: "0x765DE816845861ef97B733612E2751555f798C62",
    decimals: 18,
  },
};

export function resolveToken(symbol: string): TokenInfo {
  const key = symbol.trim().toUpperCase();
  const normalized =
    key === "G$" || key === "GDOLLAR" || key === "G"
      ? "G$"
      : key === "CUSD"
        ? "CUSD"
        : key;
  const token = TOKENS[normalized];
  if (!token) {
    throw new Error(
      `unsupported reward token "${symbol}" — creator mode supports G$, USDC, cUSD`,
    );
  }
  return token;
}

export function parseRewardAmount(reward: number, decimals: number): bigint {
  if (!Number.isFinite(reward) || reward <= 0) {
    throw new Error(`invalid reward amount: ${reward}`);
  }
  return parseUnits(reward.toFixed(Math.min(6, decimals)), decimals);
}

/**
 * Total ERC-20 pull for `createTask`.
 * Balaio charges 1% at create (from escrow) and another 1% at `claimReward`.
 * After create, escrow must still hold reward + claim fee → deposit ≈ reward × 1.02.
 */
export function computeCreationDeposit(
  rewardPerSlot: bigint,
  totalSlots: bigint,
): bigint {
  const totalReward = rewardPerSlot * totalSlots;
  const creationFee = (totalReward * 100n) / 10_000n;
  const claimFee = (totalReward * 100n) / 10_000n;
  return totalReward + creationFee + claimFee;
}
