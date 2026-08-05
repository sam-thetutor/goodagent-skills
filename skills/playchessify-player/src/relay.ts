import type { Hex } from "viem";

export interface RelayMove {
  san: string;
  player: string;
  moveNumber: number;
  ts: number;
  sig?: string;
  signer?: string;
}

export function canonicalMoveMessage(p: {
  chain: string;
  gameId: number;
  moveNumber: number;
  san: string;
  fen: string;
}): string {
  return [
    "playchessify:move",
    `chain:${p.chain}`,
    `game:${p.gameId}`,
    `n:${p.moveNumber}`,
    `san:${p.san}`,
    `fen:${p.fen}`,
  ].join("\n");
}

export class PlayChessifyRelay {
  constructor(
    private baseUrl: string,
    private timeoutMs = 25_000,
  ) {}

  async getMoves(gameId: number): Promise<RelayMove[]> {
    const res = await fetch(`${this.baseUrl}/api/games/celo/${gameId}/moves`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`moves GET failed (${res.status})`);
    }
    const data = (await res.json()) as { moves?: RelayMove[] };
    return data.moves ?? [];
  }

  async postMove(input: {
    gameId: number;
    san: string;
    player: string;
    moveNumber: number;
    sig: Hex;
  }): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${this.baseUrl}/api/games/celo/${input.gameId}/moves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          san: input.san,
          player: input.player,
          moveNumber: input.moveNumber,
          sig: input.sig,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) return;
      const text = await res.text().catch(() => "");
      if (res.status === 409 && text.includes("not active") && attempt < 7) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(`moves POST failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}
