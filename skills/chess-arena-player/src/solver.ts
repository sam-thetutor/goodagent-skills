import { spawn } from "node:child_process";
import { Chess } from "chess.js";

/** Try mate-in-one via chess.js — fast, covers many arena puzzles. */
export function findMateInOne(fen: string): string | undefined {
  try {
    const board = new Chess(fen);
    for (const san of board.moves()) {
      const trial = new Chess(fen);
      trial.move(san);
      if (trial.isCheckmate()) return san;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function runExternalSolver(cmd: string, fen: string): Promise<string | undefined> {
  const parts = cmd.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [file, ...args] = parts;
  if (!file) return undefined;

  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve(undefined));
    child.on("close", () => {
      const move = stdout.trim().split(/\n/).find((l) => l.trim())?.trim();
      resolve(move || undefined);
    });
    child.stdin.write(fen);
    child.stdin.end();
    setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 8_000);
  });
}

export async function solvePuzzle(
  fen: string,
  opts: { solverCmd?: string },
): Promise<string | undefined> {
  if (opts.solverCmd) {
    const ext = await runExternalSolver(opts.solverCmd, fen);
    if (ext) return ext;
  }
  return findMateInOne(fen);
}
