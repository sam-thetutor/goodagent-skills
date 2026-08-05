import { config as loadEnv } from "dotenv";
import { formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  createChainClients,
  findJoinableBotLobby,
  readGame,
  TOKEN_DECIMALS,
} from "./chain.js";

loadEnv();

const CHESS_TOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "faucetCooldownRemaining",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function fmtCooldown(seconds: bigint): string {
  const s = Number(seconds);
  if (s <= 0) return "ready now";
  const h = Math.floor(s / 3600);
  const m = Math.ceil((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function main(): Promise<void> {
  const privateKey = (process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY)?.trim() as
    | Hex
    | undefined;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY or AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const account = privateKeyToAccount(privateKey);
  const playerAddress = (process.env.PLAYER_ADDRESS?.trim() || account.address) as `0x${string}`;
  const clients = createChainClients(privateKey, rpcUrl);

  const maxWager = Number(process.env.MAX_WAGER ?? 100);
  const minElo = Number(process.env.TARGET_BOT_MIN_ELO ?? 600);
  const maxElo = Number(process.env.TARGET_BOT_MAX_ELO ?? 1200);

  console.log("PlayChessify mainnet dry-run");
  console.log(`wallet ${playerAddress}`);
  console.log(`rpc ${rpcUrl}`);
  console.log("");

  const [celoBal, chessBal, cooldown, target] = await Promise.all([
    clients.publicClient.getBalance({ address: playerAddress }),
    clients.publicClient.readContract({
      address: clients.token,
      abi: CHESS_TOKEN_ABI,
      functionName: "balanceOf",
      args: [playerAddress],
    }),
    clients.publicClient.readContract({
      address: clients.token,
      abi: CHESS_TOKEN_ABI,
      functionName: "faucetCooldownRemaining",
      args: [playerAddress],
    }),
    findJoinableBotLobby(clients, {
      maxWagerWhole: maxWager,
      minElo,
      maxElo,
    }),
  ]);

  const chessWhole = Number(chessBal) / 10 ** TOKEN_DECIMALS;
  console.log("── Balances ──");
  console.log(`CELO (gas):  ${formatEther(celoBal)} CELO`);
  console.log(`CHESS:       ${chessWhole.toLocaleString()} CHESS`);
  console.log("");
  console.log("── Faucet ──");
  console.log(`Cooldown:    ${fmtCooldown(cooldown)}`);
  console.log(`Can claim:   ${cooldown === 0n ? "yes (+1,000 CHESS)" : "no — wait for reset"}`);
  console.log(
    `Skill auto-claim when balance < 200 CHESS: ${chessWhole < 200 && cooldown === 0n ? "would claim on start" : chessWhole < 200 ? "blocked by cooldown" : "not needed yet"}`,
  );
  console.log("");
  console.log("── Bot lobby scan ──");
  console.log(`Filter: Elo ${minElo}-${maxElo}, max wager ${maxWager} CHESS`);
  if (!target) {
    console.log("No joinable bot lobby found in range (bots may be busy — retry later).");
  } else {
    console.log(`Best target: game #${target.gameId}`);
    console.log(`  Bot: ${target.botName} (~${target.targetRating} Elo)`);
    console.log(`  Wager: ${target.wagerWhole} CHESS`);
    const game = await readGame(clients, target.gameId);
    console.log(`  On-chain status: ${game.status} (0=Waiting)`);
    console.log(`  Would need ≥ ${target.wagerWhole} CHESS + CELO gas to joinGame()`);
    console.log(
      `  Balance check: ${chessWhole >= target.wagerWhole ? "PASS" : "FAIL — claim faucet or win games first"}`,
    );
  }

  console.log("");
  console.log("Dry-run complete — no transactions sent.");
}

main().catch((err) => {
  console.error("[dry-run error]", (err as Error).message);
  process.exit(1);
});
