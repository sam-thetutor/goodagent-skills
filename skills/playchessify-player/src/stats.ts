import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface MatchRecord {
  matchId: string;
  gameId: number;
  opponent: string;
  result: "won" | "lost" | "draw";
  wagerChess: number;
  at: string;
}

interface State {
  day: string;
  matchesToday: number;
  history: MatchRecord[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class Stats {
  private state: State;

  constructor(
    private file: string,
    private dailyMatchCap: number,
  ) {
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as State)
      : { day: today(), matchesToday: 0, history: [] };
    this.rollover();
  }

  private rollover(): void {
    if (this.state.day !== today()) {
      this.state.day = today();
      this.state.matchesToday = 0;
    }
  }

  canPlay(): { ok: boolean; reason?: string } {
    this.rollover();
    if (this.dailyMatchCap > 0 && this.state.matchesToday >= this.dailyMatchCap) {
      return {
        ok: false,
        reason: `daily cap (${this.state.matchesToday}/${this.dailyMatchCap})`,
      };
    }
    return { ok: true };
  }

  record(rec: MatchRecord): void {
    this.rollover();
    this.state.matchesToday += 1;
    this.state.history.push(rec);
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  get summary(): string {
    const wins = this.state.history.filter((h) => h.result === "won").length;
    const losses = this.state.history.filter((h) => h.result === "lost").length;
    const draws = this.state.history.filter((h) => h.result === "draw").length;
    return `${wins}W/${losses}L/${draws}D · today ${this.state.matchesToday} matches`;
  }
}
