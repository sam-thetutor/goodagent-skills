import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type PlayMode = "offchain" | "onchain";
export type ConfigPlayMode = PlayMode | "auto";

export interface MatchRecord {
  matchId: string;
  gameType: number;
  wagerGs: number;
  result: "won" | "lost" | "unresolved";
  mode: PlayMode;
  strategy?: string;
  at: string;
}

export interface RefillRecord {
  priceGs: number;
  txHash: string;
  at: string;
}

export interface BankrollHooks {
  onMatch?: (rec: MatchRecord) => void;
  onRefill?: (rec: RefillRecord) => void;
}

interface State {
  day: string;
  lostTodayGs: number;
  matchesToday: number;
  refillsToday: number;
  spentOnRefillsTodayGs: number;
  refillHistory: RefillRecord[];
  history: MatchRecord[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * File-backed daily limits. On-chain mode tracks G$ lost; off-chain tracks
 * match count and optional refill spend caps.
 */
export class Bankroll {
  private state: State;

  constructor(
    private file: string,
    private mode: ConfigPlayMode,
    private dailyLossCapGs: number,
    /** 0 = unlimited matches per UTC day */
    private dailyMatchCap: number,
    private dailyRefillCapGs: number,
    private maxRefillsPerDay: number,
    private hooks?: BankrollHooks,
  ) {
    const raw = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Partial<State>)
      : {};
    this.state = {
      day: raw.day ?? today(),
      lostTodayGs: raw.lostTodayGs ?? 0,
      matchesToday: raw.matchesToday ?? 0,
      refillsToday: raw.refillsToday ?? 0,
      spentOnRefillsTodayGs: raw.spentOnRefillsTodayGs ?? 0,
      refillHistory: raw.refillHistory ?? [],
      history: raw.history ?? [],
    };
    this.rollover();
    this.migrateLegacyRecords();
  }

  private migrateLegacyRecords(): void {
    for (const rec of this.state.history) {
      if (!rec.mode) rec.mode = "onchain";
    }
  }

  private rollover(): void {
    if (this.state.day !== today()) {
      this.state.day = today();
      this.state.lostTodayGs = 0;
      this.state.matchesToday = 0;
      this.state.refillsToday = 0;
      this.state.spentOnRefillsTodayGs = 0;
      this.state.refillHistory = [];
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  canPlay(wagerGs: number): { ok: boolean; reason?: string } {
    this.rollover();
    if (this.dailyMatchCap > 0 && this.state.matchesToday >= this.dailyMatchCap) {
      return {
        ok: false,
        reason: `daily match cap: played ${this.state.matchesToday} of ${this.dailyMatchCap} matches today`,
      };
    }
    if (wagerGs > 0 && this.state.lostTodayGs + wagerGs > this.dailyLossCapGs) {
      return {
        ok: false,
        reason: `daily loss cap: lost ${this.state.lostTodayGs} G$ of ${this.dailyLossCapGs} G$ cap, next wager ${wagerGs} G$ would exceed it`,
      };
    }
    return { ok: true };
  }

  canBuyRefill(priceGs: number): { ok: boolean; reason?: string } {
    this.rollover();
    if (this.maxRefillsPerDay > 0 && this.state.refillsToday >= this.maxRefillsPerDay) {
      return {
        ok: false,
        reason: `refill cap: bought ${this.state.refillsToday} of ${this.maxRefillsPerDay} refills today`,
      };
    }
    if (
      this.dailyRefillCapGs > 0 &&
      this.state.spentOnRefillsTodayGs + priceGs > this.dailyRefillCapGs
    ) {
      return {
        ok: false,
        reason: `refill spend cap: spent ${this.state.spentOnRefillsTodayGs} G$ of ${this.dailyRefillCapGs} G$ refill budget`,
      };
    }
    return { ok: true };
  }

  recordRefill(priceGs: number, txHash: string): void {
    this.rollover();
    this.state.refillsToday += 1;
    this.state.spentOnRefillsTodayGs += priceGs;
    this.state.refillHistory.push({
      priceGs,
      txHash,
      at: new Date().toISOString(),
    });
    this.persist();
    const rec = this.state.refillHistory[this.state.refillHistory.length - 1];
    this.hooks?.onRefill?.(rec);
  }

  record(rec: MatchRecord): void {
    this.rollover();
    this.state.matchesToday += 1;
    if (rec.result === "lost" && rec.mode === "onchain") {
      this.state.lostTodayGs += rec.wagerGs;
    }
    this.state.history.push(rec);
    this.persist();
    this.hooks?.onMatch?.(rec);
  }

  get summary(): string {
    const wins = this.state.history.filter((h) => h.result === "won").length;
    const losses = this.state.history.filter((h) => h.result === "lost").length;
    const cap = this.dailyMatchCap > 0 ? `/${this.dailyMatchCap}` : "";
    const refill =
      this.state.refillsToday > 0
        ? ` · refills ${this.state.refillsToday} (${this.state.spentOnRefillsTodayGs} G$)`
        : "";
    const loss =
      this.state.lostTodayGs > 0 ? ` · ${this.state.lostTodayGs} G$ lost` : "";
    return `lifetime ${wins}W/${losses}L · today ${this.state.matchesToday}${cap} matches${refill}${loss}`;
  }
}
