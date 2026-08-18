import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  maxUint256,
  type Address,
} from "viem";
import { celo } from "viem/chains";
import type { LocalAccount } from "viem/accounts";
import {
  ERC20_ABI,
  G_DOLLAR,
  G_USDM_EXCHANGE_ID,
  MENTO_BROKER,
  MENTO_BROKER_ABI,
  MENTO_PROVIDER,
  UNISWAP_ROUTER,
  UNISWAP_ROUTER_ABI,
  USDM,
  USDM_USDT_FEE,
  USDT,
} from "./abis.js";

const SLIPPAGE_BPS = 200n;
const BPS = 10_000n;

function applySlippageUp(amount: bigint): bigint {
  return (amount * (BPS + SLIPPAGE_BPS) + BPS - 1n) / BPS;
}

function applySlippageDown(amount: bigint): bigint {
  return (amount * (BPS - SLIPPAGE_BPS)) / BPS;
}

/** Swap G$ → USDm (MentoBroker) → USDT (Uniswap V3) per GoodAgent funding path. */
export async function ensureUsdtFromGs(
  account: LocalAccount,
  rpcUrl: string,
  targetUsdt: bigint,
  minGsReserve: bigint,
): Promise<boolean> {
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain: celo, transport });
  const wallet = createWalletClient({ account, chain: celo, transport });
  const owner = account.address;

  const usdtBal = await pub.readContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (usdtBal >= targetUsdt) return false;

  const shortfall = targetUsdt - usdtBal;
  const usdmNeeded = applySlippageUp(shortfall * 10n ** 12n);
  const gsRequired = await pub.readContract({
    address: MENTO_BROKER,
    abi: MENTO_BROKER_ABI,
    functionName: "getAmountIn",
    args: [MENTO_PROVIDER, G_USDM_EXCHANGE_ID, G_DOLLAR, USDM, usdmNeeded],
  });
  const gsMax = applySlippageUp(gsRequired);

  const gsBal = await pub.readContract({
    address: G_DOLLAR,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  const spendable = gsBal > minGsReserve ? gsBal - minGsReserve : 0n;
  if (spendable < gsMax) {
    throw new Error(
      `Insufficient G$ for USDT swap: need ~${formatUnits(gsMax, 18)} G$, ` +
        `have ${formatUnits(spendable, 18)} spendable`,
    );
  }

  console.log(
    `[swap] G$ → USDT target ${formatUnits(targetUsdt, 6)} (~${formatUnits(gsMax, 18)} G$)`,
  );

  let gsAllowance = await pub.readContract({
    address: G_DOLLAR,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, MENTO_BROKER],
  });
  if (gsAllowance < gsMax) {
    const hash = await wallet.writeContract({
      account,
      chain: celo,
      address: G_DOLLAR,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [MENTO_BROKER, maxUint256],
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const usdmBefore = await pub.readContract({
    address: USDM,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });

  const mentoHash = await wallet.writeContract({
    account,
    chain: celo,
    address: MENTO_BROKER,
    abi: MENTO_BROKER_ABI,
    functionName: "swapOut",
    args: [MENTO_PROVIDER, G_USDM_EXCHANGE_ID, G_DOLLAR, USDM, usdmNeeded, gsMax],
  });
  await pub.waitForTransactionReceipt({ hash: mentoHash });

  const usdmAfter = await pub.readContract({
    address: USDM,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  const usdmReceived = usdmAfter - usdmBefore;
  if (usdmReceived <= 0n) throw new Error("Mento swap produced no USDm");

  const usdmAllowance = await pub.readContract({
    address: USDM,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, UNISWAP_ROUTER],
  });
  if (usdmAllowance < usdmReceived) {
    const hash = await wallet.writeContract({
      account,
      chain: celo,
      address: USDM,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [UNISWAP_ROUTER, maxUint256],
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const swapHash = await wallet.writeContract({
    account,
    chain: celo,
    address: UNISWAP_ROUTER,
    abi: UNISWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDM,
        tokenOut: USDT,
        fee: USDM_USDT_FEE,
        recipient: owner,
        deadline,
        amountIn: usdmReceived,
        amountOutMinimum: applySlippageDown(shortfall),
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  await pub.waitForTransactionReceipt({ hash: swapHash });

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
