/**
 * Agent vs agent live test: fund two HD wallets, host creates room, joiner joins, both play.
 */
import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { createChainClients, ensureChessBankroll, readGame, GameStatus } from "../src/chain.js";
import { createGame, joinOpenLobby, waitUntilActive } from "../src/lobby.js";
import { playMovesUntilDone, type MatchContext } from "../src/match.js";
import { resolveEngine } from "../src/presets.js";
import { PlayChessifyRelay } from "../src/relay.js";

const MNEMONIC = process.env.DEPLOY_MNEMONIC?.replace(/^"|"$/g, "") ??
  "style logic critic fold bundle lemon motor material shuffle dust now split";
const TREASURY_KEY = process.env.PRIVATE_KEY?.trim() as Hex | undefined;
const RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const BASE = (process.env.PLAYCHESSIFY_URL ?? "https://celo.playchessify.xyz").replace(/\/$/, "");
const WAGER = Number(process.env.HOST_WAGER ?? 100);

function agentKey(index: number): Hex {
  const account = mnemonicToAccount(MNEMONIC, {
    path: `m/44'/60'/0'/0/${index}`,
  }) as LocalAccount & { getHdKey: () => { privateKey: Uint8Array } };
  const hd = account.getHdKey();
  if (!hd?.privateKey) throw new Error(`derive failed index ${index}`);
  return bytesToHex(hd.privateKey) as Hex;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const CELO_TOPUP = parseEther("0.2");
const CELO_MIN = parseEther("0.15");

async function fundCelo(to: `0x${string}`): Promise<void> {
  if (!TREASURY_KEY) throw new Error("PRIVATE_KEY required to top up CELO");
  const treasury = privateKeyToAccount(TREASURY_KEY);
  const pub = createPublicClient({ chain: celo, transport: http(RPC) });
  const bal = await pub.getBalance({ address: to });
  if (bal >= CELO_MIN) {
    console.log(`[fund] ${to.slice(0, 10)}… CELO ok (${formatEther(bal)})`);
    return;
  }
  const wallet = createWalletClient({ account: treasury, chain: celo, transport: http(RPC) });
  console.log(`[fund] ${formatEther(CELO_TOPUP)} CELO → ${to}`);
  const hash = await wallet.sendTransaction({
    account: treasury,
    to,
    value: CELO_TOPUP,
  });
  await pub.waitForTransactionReceipt({ hash });
}

function buildCtx(privateKey: Hex, label: string): MatchContext {
  const account = mnemonicToAccount(MNEMONIC, {
    path: `m/44'/60'/0'/0/${label === "host" ? 0 : 1}`,
  }) as LocalAccount;
  // use derived key for chain client
  const pk = label === "host" ? agentKey(0) : agentKey(1);
  const acc = privateKeyToAccount(pk);
  const { engine } = resolveEngine();
  return {
    clients: createChainClients(pk, RPC),
    relay: new PlayChessifyRelay(BASE),
    account: acc,
    playerAddress: acc.address,
    engine,
    stats: { canPlay: () => ({ ok: true }), record: () => {}, summary: "" } as MatchContext["stats"],
    pollMs: 800,
    thinkMs: 400,
  };
}

async function main(): Promise<void> {
  const hostPk = agentKey(0);
  const joinPk = agentKey(1);
  const hostAcc = privateKeyToAccount(hostPk);
  const joinAcc = privateKeyToAccount(joinPk);

  console.log("=== PlayChessify agent vs agent ===");
  console.log(`host  ${hostAcc.address}`);
  console.log(`join  ${joinAcc.address}`);
  console.log(`wager ${WAGER} CHESS · ${BASE}\n`);

  await fundCelo(hostAcc.address);
  await fundCelo(joinAcc.address);

  const hostClients = createChainClients(hostPk, RPC);
  const joinClients = createChainClients(joinPk, RPC);
  await ensureChessBankroll(hostClients);
  await ensureChessBankroll(joinClients);
  await fundCelo(hostAcc.address);
  await fundCelo(joinAcc.address);

  const pub = createPublicClient({ chain: celo, transport: http(RPC) });
  const balAbi = [
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
  ] as const;
  const token = hostClients.token;
  const [hChess, jChess] = await Promise.all([
    pub.readContract({ address: token, abi: balAbi, functionName: "balanceOf", args: [hostAcc.address] }),
    pub.readContract({ address: token, abi: balAbi, functionName: "balanceOf", args: [joinAcc.address] }),
  ]);
  console.log(`host CHESS ${Number(formatUnits(hChess, 6))} · join CHESS ${Number(formatUnits(jChess, 6))}\n`);

  const hostCtx = buildCtx(hostPk, "host");
  const joinCtx = buildCtx(joinPk, "join");

  const gameId = await createGame(hostClients, WAGER);
  console.log(`[host] created game #${gameId} — joiner joining in 5s…`);

  await sleep(2000);
  await joinOpenLobby(joinClients, gameId);
  console.log(`[join] joined game #${gameId}`);

  await waitUntilActive(hostClients, gameId, 120_000, 2000);
  console.log(`[game ${gameId}] active — both agents playing\n`);

  await Promise.all([
    playMovesUntilDone(hostCtx, gameId),
    playMovesUntilDone(joinCtx, gameId),
  ]);

  console.log("\n[game] waiting for on-chain settlement…");
  for (let i = 0; i < 40; i++) {
    const g = await readGame(hostClients, gameId);
    if (g.status === GameStatus.Finished || g.status === GameStatus.Draw) {
      console.log(`[game ${gameId}] settled status=${g.status} result=${g.result}`);
      console.log(`white ${g.white} · black ${g.black}`);
      const [hAfter, jAfter] = await Promise.all([
        pub.readContract({ address: token, abi: balAbi, functionName: "balanceOf", args: [hostAcc.address] }),
        pub.readContract({ address: token, abi: balAbi, functionName: "balanceOf", args: [joinAcc.address] }),
      ]);
      console.log(`\nFinal CHESS — host: ${Number(formatUnits(hAfter, 6))} · join: ${Number(formatUnits(jAfter, 6))}`);
      console.log(`View: ${BASE}/app/game/${gameId}`);
      return;
    }
    await sleep(3000);
  }
  console.warn("Settlement still pending — check game on PlayChessify");
}

main().catch((err) => {
  console.error("[failed]", (err as Error).message);
  process.exit(1);
});
