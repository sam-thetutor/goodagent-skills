#!/usr/bin/env node
/**
 * Arena-compatible puzzle solver: read FEN from stdin, print one SAN move on stdout.
 * Uses the npm `stockfish` engine via UCI subprocess (see arena engine-setup.md).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const movetime = Math.max(
  100,
  Math.min(3000, Number(process.env.SOLVER_MOVETIME_MS ?? 450) || 450),
);

function findEnginePath() {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("stockfish/package.json");
  const pkgDir = dirname(pkgJson);
  const candidates = [
    join(pkgDir, "bin/stockfish-18-single.js"),
    join(pkgDir, "bin/stockfish-17-single.js"),
    join(pkgDir, "bin/stockfish-16-single.js"),
    join(pkgDir, "bin/stockfish.js"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error("stockfish engine binary not found — run npm install in the skill dir");
}

function sanOf(fen, uciMove) {
  try {
    const board = new Chess(fen);
    const move = board.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove.length > 4 ? uciMove[4] : undefined,
    });
    return move?.san;
  } catch {
    return undefined;
  }
}

function readStdinFen() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function uciBestSan(fen, enginePath) {
  return new Promise((resolve) => {
    const child = spawn("node", [enginePath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let settled = false;
    const finish = (san) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(san);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("bestmove")) {
          const match = /^bestmove\s+(\S+)/.exec(trimmed);
          const uci = match?.[1];
          if (uci && uci !== "(none)") {
            finish(sanOf(fen, uci));
            return;
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => finish(undefined));

    child.stdin.write("uci\n");
    child.stdin.write("setoption name Threads value 1\n");
    child.stdin.write("isready\n");
    child.stdin.write("ucinewgame\n");
    child.stdin.write(`position fen ${fen}\n`);
    child.stdin.write(`go movetime ${movetime}\n`);

    setTimeout(() => finish(undefined), movetime + 4000);
  });
}

async function main() {
  const fen = await readStdinFen();
  if (!fen) process.exit(0);
  try {
    const enginePath = findEnginePath();
    const san = await uciBestSan(fen, enginePath);
    if (san) process.stdout.write(`${san}\n`);
  } catch (err) {
    process.stderr.write(`${(err instanceof Error ? err.message : String(err))}\n`);
    process.exit(1);
  }
}

main();
