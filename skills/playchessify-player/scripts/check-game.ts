import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import {
  CHESS_GAME_V2,
  readGame,
  type ChainClients,
} from "../src/chain.js";

const gameId = Number(process.argv[2] ?? 0);
if (!gameId) {
  console.error("usage: check-game.ts <gameId>");
  process.exit(1);
}

const rpc = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const game = (process.env.CHESS_GAME ?? CHESS_GAME_V2) as `0x${string}`;
const clients = {
  publicClient: createPublicClient({ chain: celo, transport: http(rpc) }),
  game,
} as Pick<ChainClients, "publicClient" | "game">;

const g = await readGame(clients as ChainClients, gameId);
console.log({
  gameId,
  game,
  status: g.status,
  result: g.result,
  white: g.white,
  black: g.black,
  wager: Number(g.wager) / 1e6,
});
