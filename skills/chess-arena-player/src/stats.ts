import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface MatchRecord {
  tournamentId: number;
  role: "open" | "accept";
  puzzlesSolved: number;
  ratingSum: number;
  result?: string;
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
    const n = this.state.history.length;
    const solved = this.state.history.reduce((a, h) => a + h.puzzlesSolved, 0);
    return `${n} tournaments · ${solved} puzzles solved · today ${this.state.matchesToday}`;
  }
}
