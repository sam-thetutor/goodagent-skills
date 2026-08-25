import { config as loadEnv } from "dotenv";

loadEnv();

const name = process.env.PLAYER_NAME?.trim() || "Kasuku matches";
const deployId = process.env.DEPLOY_ID?.trim() || "";

console.log(
  `[kasuku-matches] ${name}${deployId ? ` deploy=${deployId}` : ""} — brain-only skill; catalog tools run on the agent brain`,
);

const shutdown = (signal: string) => {
  console.log(`[kasuku-matches] ${signal} — stopping`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

setInterval(() => {}, 60_000);
