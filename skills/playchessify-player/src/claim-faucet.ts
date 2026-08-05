import { config as loadEnv } from "dotenv";
import { formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  createChainClients,
  ensureChessBankroll,
  findJoinableBotLobby,
  TOKEN_DECIMALS,
} from "./chain.js";

loadEnv();

async function main(): Promise<void> {
  const privateKey = (process.env.PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY)?.trim() as
    | Hex
    | undefined;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY or AGENT_PRIVATE_KEY");
    process.exit(1);
  }

  const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
  const account = privateKeyToAccount(privateKey);
  const clients = createChainClients(privateKey, rpcUrl);

  console.log(`wallet ${account.address}`);
  console.log("Calling ensureChessBankroll (faucet + approve)…");
  await ensureChessBankroll(clients);

  const bal = await clients.publicClient.readContract({
    address: clients.token,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ] as const,
    functionName: "balanceOf",
    args: [clients.account],
  });

  console.log(`CHESS balance: ${Number(formatUnits(bal, TOKEN_DECIMALS))} CHESS`);

  const target = await findJoinableBotLobby(clients, {
    maxWagerWhole: Number(process.env.MAX_WAGER ?? 100),
    minElo: Number(process.env.TARGET_BOT_MIN_ELO ?? 600),
    maxElo: Number(process.env.TARGET_BOT_MAX_ELO ?? 1200),
  });

  if (target) {
    console.log(
      `Joinable lobby: game #${target.gameId} vs ${target.botName} · ${target.wagerWhole} CHESS`,
    );
  } else {
    console.log("No joinable bot lobby in Elo/wager range right now.");
  }
}

main().catch((err) => {
  console.error("[claim error]", (err as Error).message);
  process.exit(1);
});
