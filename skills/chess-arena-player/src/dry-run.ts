import { config as loadEnv } from "dotenv";
import { formatUnits } from "viem";
import { loadConfig } from "./config.js";
import { createChainClients, readStakeAmount } from "./arena-chain.js";
import { createArenaApi } from "./arena-api.js";
import { readUsdtBalance } from "./swap.js";

loadEnv();

async function main(): Promise<void> {
  const config = loadConfig();
  const clients = createChainClients(config);
  const api = createArenaApi(config.arenaUrl, config.account);

  console.log("Chess Arena dry-run");
  console.log(`wallet ${config.playerAddress}`);
  console.log(`arena ${config.arenaUrl}`);

  const stake = await readStakeAmount(clients);
  const usdt = await readUsdtBalance(config.playerAddress, config.rpcUrl);
  console.log(`USDT balance ${formatUnits(usdt, 6)} · stake ${formatUnits(stake, 6)}`);

  const { lobbies, count, capacity } = await api.getOpenLobbies();
  console.log(`open lobbies ${count}/${capacity}`);
  if (lobbies.length > 0) {
    console.log(`first open lobby id=${lobbies[0]!.id}`);
  }

  try {
    const token = await api.signIn();
    console.log(`auth ok (${token.length} char token)`);
  } catch (e) {
    console.log(`auth failed: ${(e as Error).message}`);
  }

  if (usdt < stake) {
    console.log("⚠ USDT below stake — enable AUTO_SWAP=1 or fund USDT before playing");
  } else {
    console.log("✓ USDT sufficient for one stake");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
