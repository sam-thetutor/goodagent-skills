import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  parseAbiParameters,
  parseUnits,
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from "viem";
import { celo } from "viem/chains";
import type { LocalAccount } from "viem/accounts";
import {
  ERC20_ABI,
  G_DOLLAR,
  GS_USDM_FEE,
  PERMIT2,
  PERMIT2_ABI,
  UNISWAP_QUOTER,
  UNISWAP_QUOTER_ABI,
  UNISWAP_UNIVERSAL_ROUTER,
  UNISWAP_UNIVERSAL_ROUTER_ABI,
  UNISWAP_V3_SWAP_EXACT_IN_COMMAND,
  USDM,
  USDM_USDT_FEE,
  USDT,
} from "./abis.js";

const SLIPPAGE_BPS = 200n;
const BPS = 10_000n;
const PERMIT2_MAX_AMOUNT = 2n ** 160n - 1n;

type CeloPublic = PublicClient<HttpTransport, typeof celo>;
type CeloWallet = WalletClient<HttpTransport, typeof celo, LocalAccount>;

function applySlippageUp(amount: bigint): bigint {
  return (amount * (BPS + SLIPPAGE_BPS) + BPS - 1n) / BPS;
}

function applySlippageDown(amount: bigint): bigint {
  return (amount * (BPS - SLIPPAGE_BPS)) / BPS;
}

function encodeUniswapPath(tokens: Address[], fees: number[]): Hex {
  let encoded = tokens[0].slice(2).toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    encoded += fees[i]!.toString(16).padStart(6, "0");
    encoded += tokens[i + 1]!.slice(2).toLowerCase();
  }
  return `0x${encoded}` as Hex;
}

function tokenInFromPath(path: Hex): Address {
  return getAddress(`0x${path.slice(2, 42)}`);
}

async function quoteGsForUsdm(pub: CeloPublic, usdmNeeded: bigint): Promise<bigint> {
  if (usdmNeeded <= 0n) return 0n;
  let lo = 1n;
  let hi = parseUnits("50000", 18);
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const [usdmOut] = await pub.readContract({
      address: UNISWAP_QUOTER,
      abi: UNISWAP_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: G_DOLLAR,
          tokenOut: USDM,
          amountIn: mid,
          fee: GS_USDM_FEE,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    if (usdmOut >= usdmNeeded) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

async function ensurePermit2Allowance(
  wallet: CeloWallet,
  pub: CeloPublic,
  token: Address,
  owner: Address,
  amount: bigint,
): Promise<void> {
  const erc20Allowance = await pub.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, PERMIT2],
  });
  if (erc20Allowance < amount) {
    const hash = await wallet.writeContract({
      account: wallet.account,
      chain: celo,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2, maxUint256],
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const [permit2Amount] = await pub.readContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, UNISWAP_UNIVERSAL_ROUTER],
  });
  if (permit2Amount < amount) {
    const expiration = Math.floor(Date.now() / 1000) + 86400 * 30;
    const hash = await wallet.writeContract({
      account: wallet.account,
      chain: celo,
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [token, UNISWAP_UNIVERSAL_ROUTER, PERMIT2_MAX_AMOUNT, expiration],
    });
    await pub.waitForTransactionReceipt({ hash });
  }
}

async function universalV3SwapExactIn(
  wallet: CeloWallet,
  pub: CeloPublic,
  owner: Address,
  path: Hex,
  amountIn: bigint,
  amountOutMinimum: bigint,
): Promise<void> {
  await ensurePermit2Allowance(wallet, pub, tokenInFromPath(path), owner, amountIn);
  const swapInput = encodeAbiParameters(
    parseAbiParameters(
      "address recipient, uint256 amountIn, uint256 amountOutMinimum, bytes path, bool payerIsUser",
    ),
    [owner, amountIn, amountOutMinimum, path, true],
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const hash = await wallet.writeContract({
    account: wallet.account,
    chain: celo,
    address: UNISWAP_UNIVERSAL_ROUTER,
    abi: UNISWAP_UNIVERSAL_ROUTER_ABI,
    functionName: "execute",
    args: [UNISWAP_V3_SWAP_EXACT_IN_COMMAND, [swapInput], deadline],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Uniswap swap reverted: ${hash}`);
  }
}

/** Swap G$ → USDm → USDT via Uniswap Universal Router (G$ requires Permit2). */
export async function ensureUsdtFromGs(
  account: LocalAccount,
  rpcUrl: string,
  targetUsdt: bigint,
  minGsReserve: bigint,
): Promise<boolean> {
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain: celo, transport }) as CeloPublic;
  const wallet = createWalletClient({ account, chain: celo, transport }) as CeloWallet;
  const owner = account.address;

  let usdtBal = await pub.readContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (usdtBal >= targetUsdt) return false;

  let usdmBal = await pub.readContract({
    address: USDM,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (usdmBal > 0n) {
    await universalV3SwapExactIn(
      wallet,
      pub,
      owner,
      encodeUniswapPath([USDM, USDT], [USDM_USDT_FEE]),
      usdmBal,
      0n,
    );
    usdtBal = await pub.readContract({
      address: USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    });
    if (usdtBal >= targetUsdt) {
      console.log(`[swap] USDT balance now ${formatUnits(usdtBal, 6)}`);
      return true;
    }
  }

  const shortfall = targetUsdt - usdtBal;
  const usdmNeeded = applySlippageUp(shortfall * 10n ** 12n);
  const gsRequired = await quoteGsForUsdm(pub, usdmNeeded);
  const gsIn = applySlippageUp(gsRequired);

  const gsBal = await pub.readContract({
    address: G_DOLLAR,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  const spendable = gsBal > minGsReserve ? gsBal - minGsReserve : 0n;
  if (spendable < gsIn) {
    throw new Error(
      `Insufficient G$ for USDT swap: need ~${formatUnits(gsIn, 18)} G$, ` +
        `have ${formatUnits(spendable, 18)} spendable`,
    );
  }

  console.log(
    `[swap] G$ → USDT via Uniswap Universal Router target ${formatUnits(targetUsdt, 6)} (~${formatUnits(gsIn, 18)} G$)`,
  );

  await universalV3SwapExactIn(
    wallet,
    pub,
    owner,
    encodeUniswapPath([G_DOLLAR, USDM], [GS_USDM_FEE]),
    gsIn,
    applySlippageDown(usdmNeeded),
  );

  usdmBal = await pub.readContract({
    address: USDM,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (usdmBal <= 0n) throw new Error("Uniswap G$ → USDm swap produced no USDm");

  await universalV3SwapExactIn(
    wallet,
    pub,
    owner,
    encodeUniswapPath([USDM, USDT], [USDM_USDT_FEE]),
    usdmBal,
    0n,
  );

  const finalUsdt = await pub.readContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  console.log(`[swap] USDT balance now ${formatUnits(finalUsdt, 6)}`);
  return true;
}

export async function readUsdtBalance(
  account: Address,
  rpcUrl: string,
): Promise<bigint> {
  const pub = createPublicClient({ chain: celo, transport: http(rpcUrl) });
  return pub.readContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}
