import { config as loadEnv } from "dotenv";
import { loadRuntimeConfig } from "./config.js";
import { runWorkerPass } from "./worker.js";

loadEnv();

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  console.log(
    `[start] productclank-participant — cap ${config.dailySubmitCap}/day, scan every ${config.scanSeconds}s, x_handle @${config.xHandle || "?"}${config.dryRun ? " (DRY_RUN)" : ""}`,
  );

  for (;;) {
    try {
      await runWorkerPass(config);
    } catch (error) {
      console.error(`[pass] failed: ${(error as Error).message}`);
    }
    if (config.runOnce) break;
    await new Promise((resolve) =>
      setTimeout(resolve, config.scanSeconds * 1000),
    );
  }
}

main().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
