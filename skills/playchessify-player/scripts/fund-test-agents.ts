/** One-shot: fund two HD test agents with CELO, claim CHESS faucet, approve game contract. */
import { bytesToHex } from "viem";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";
import { celo } from "viem/chains";
import { config as loadEnv } from "dotenv";
import { createChainClients, ensureChessBankroll } from "../src/chain.js";

loadEnv();
loadEnv({ path: new URL("../../../fff/.env", import.meta.url).pathname });

const MNEMONIC =
  process.env.DEPLOY_MNEMONIC?.replace(/^"|"$/g, "") ??
  "style logic critic fold bundle lemon motor material shuffle dust now split";
const treasuryKey = process.env.PRIVATE_KEY?.trim();
if (!treasuryKey) throw new Error("PRIVATE_KEY required (treasury wallet for CELO top-up)");

const rpc = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const treasury = privateKeyToAccount(treasuryKey as Hex);
const pub = createPublicClient({ chain: celo, transport: http(rpc) });
const treasuryWallet = createWalletClient({
  account: treasury,
  chain: celo,
  transport: http(rpc),
});

const CELO_TOPUP = parseEther("0.2");
const CELO_MIN = parseEther("0.15");

function agentKey(index: number): Hex {
  const account = mnemonicToAccount(MNEMONIC, {
    path: `m/44'/60'/0'/0/${index}`,
  }) as LocalAccount & { getHdKey: () => { privateKey: Uint8Array } };
  const hd = account.getHdKey();
  if (!hd?.privateKey) throw new Error(`derive failed index ${index}`);
  return bytesToHex(hd.privateKey) as Hex;
}

async function main(): Promise<void> {
  console.log("Funding agents 0 (host) and 1 (joiner)…");
  for (const index of [0, 1]) {
    const pk = agentKey(index);
    const agent = privateKeyToAccount(pk);
    const bal = await pub.getBalance({ address: agent.address });
    if (bal < CELO_MIN) {
      console.log(`[${index}] sending ${formatEther(CELO_TOPUP)} CELO → ${agent.address}`);
      const hash = await treasuryWallet.sendTransaction({
        account: treasury,
        to: agent.address,
        value: CELO_TOPUP,
      });
      await pub.waitForTransactionReceipt({ hash });
    }
    const clients = createChainClients(pk, rpc);
    await ensureChessBankroll(clients);
    console.log(`[${index}] ready ${agent.address}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
