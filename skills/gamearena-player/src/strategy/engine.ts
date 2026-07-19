import { randomInt } from "node:crypto";
import { GameType, MOVE_NAMES, parseRpsToken } from "./constants.js";

export type MarkovStrategyId = "random" | "sequence" | "fixed" | "counter";

export interface MoveContext {
  gameType: number;
  round?: number;
  lastAiMove?: number;
  matchId?: string;
}

export interface StrategyMove {
  move: number;
  label: string;
}

export interface MarkovStrategy {
  readonly id: MarkovStrategyId;
  beginMatch(matchId: string): void;
  nextMove(ctx: MoveContext): StrategyMove;
}

function randomMove(gameType: number): StrategyMove {
  let move: number;
  switch (gameType) {
    case GameType.RockPaperScissors:
      move = randomInt(3);
      break;
    case GameType.CoinFlip:
      move = randomInt(2);
      break;
    case GameType.DiceRoll:
      move = randomInt(1, 7);
      break;
    case GameType.StrategyBattle:
      move = randomInt(10);
      break;
    default:
      throw new Error(`Unsupported game type: ${gameType}`);
  }
  const label = MOVE_NAMES[gameType]?.[move] ?? String(move);
  return { move, label };
}

function counterRps(aiMove: number): number {
  return (aiMove + 1) % 3;
}

class RandomStrategy implements MarkovStrategy {
  readonly id = "random" as const;

  beginMatch(_matchId: string): void {}

  nextMove(ctx: MoveContext): StrategyMove {
    return randomMove(ctx.gameType);
  }
}

class SequenceStrategy implements MarkovStrategy {
  readonly id = "sequence" as const;
  private index = 0;

  constructor(private readonly moves: number[]) {}

  beginMatch(_matchId: string): void {
    // Keep cycling across matches — predictable patterns are intentional.
  }

  nextMove(ctx: MoveContext): StrategyMove {
    if (ctx.gameType !== GameType.RockPaperScissors) {
      return randomMove(ctx.gameType);
    }
    const move = this.moves[this.index % this.moves.length]!;
    this.index += 1;
    return {
      move,
      label: MOVE_NAMES[GameType.RockPaperScissors]![move]!,
    };
  }
}

class FixedStrategy implements MarkovStrategy {
  readonly id = "fixed" as const;

  constructor(private readonly fixedMove: number) {}

  beginMatch(_matchId: string): void {}

  nextMove(ctx: MoveContext): StrategyMove {
    if (ctx.gameType !== GameType.RockPaperScissors) {
      return randomMove(ctx.gameType);
    }
    return {
      move: this.fixedMove,
      label: MOVE_NAMES[GameType.RockPaperScissors]![this.fixedMove]!,
    };
  }
}

class CounterStrategy implements MarkovStrategy {
  readonly id = "counter" as const;
  private readonly fallback = new RandomStrategy();

  beginMatch(_matchId: string): void {}

  nextMove(ctx: MoveContext): StrategyMove {
    if (
      ctx.gameType !== GameType.RockPaperScissors ||
      ctx.lastAiMove == null ||
      ctx.lastAiMove < 0 ||
      ctx.lastAiMove > 2
    ) {
      return this.fallback.nextMove(ctx);
    }
    const move = counterRps(ctx.lastAiMove);
    return {
      move,
      label: MOVE_NAMES[GameType.RockPaperScissors]![move]!,
    };
  }
}

function parseSequence(raw: string | undefined): number[] {
  const tokens = (raw ?? "rock,paper,scissors")
    .split(/[,/\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return [0, 1, 2];
  }
  return tokens.map(parseRpsToken);
}

export function createMarkovStrategy(): MarkovStrategy {
  const id = (process.env.MARKOV_STRATEGY ?? "random").trim().toLowerCase();

  switch (id) {
    case "random":
      return new RandomStrategy();
    case "sequence":
      return new SequenceStrategy(parseSequence(process.env.RPS_SEQUENCE));
    case "fixed": {
      const fixed = parseRpsToken(process.env.RPS_FIXED ?? "rock");
      return new FixedStrategy(fixed);
    }
    case "counter":
      return new CounterStrategy();
    default:
      console.error(
        `MARKOV_STRATEGY must be random, sequence, fixed, or counter (got "${id}")`,
      );
      process.exit(1);
  }
}

export function strategyLabel(strategy: MarkovStrategy): string {
  if (strategy.id === "sequence") {
    const seq = (process.env.RPS_SEQUENCE ?? "rock,paper,scissors").trim();
    return `sequence(${seq})`;
  }
  if (strategy.id === "fixed") {
    return `fixed(${process.env.RPS_FIXED ?? "rock"})`;
  }
  return strategy.id;
}
