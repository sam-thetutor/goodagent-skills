import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { ARENA_ADDRESS, MARKOV_ADDRESS, MatchStatus } from "./src/arena.js";

async function main() {
  const pub = createPublicClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
  });
  const abi = [
    {
      type: "function",
      name: "matches",
      stateMutability: "view",
      inputs: [{ name: "", type: "uint256" }],
      outputs: [
        { name: "id", type: "uint256" },
        { name: "challenger", type: "address" },
        { name: "opponent", type: "address" },
        { name: "wager", type: "uint256" },
        { name: "gameType", type: "uint8" },
        { name: "status", type: "uint8" },
        { name: "winner", type: "address" },
        { name: "createdAt", type: "uint256" },
      ],
    },
  ] as const;
  const statusNames = ["Proposed", "Accepted", "Completed", "Cancelled"];
  console.log("MARKOV wallet:", MARKOV_ADDRESS);
  for (const id of [1249n, 1250n, 1251n, 1252n, 1253n, 1254n, 1255n]) {
    const m = await pub.readContract({
      address: ARENA_ADDRESS,
      abi,
      functionName: "matches",
      args: [id],
    });
    const created = new Date(Number(m[7]) * 1000).toISOString();
    console.log(
      `#${id} ${statusNames[m[5]]} created=${created} winner=${m[6]}`,
    );
  }
}

main();
