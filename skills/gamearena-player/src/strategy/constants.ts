export const GameType = {
  RockPaperScissors: 0,
  DiceRoll: 1,
  StrategyBattle: 2,
  CoinFlip: 3,
} as const;

export const GAME_NAMES: Record<number, string> = {
  0: "Rock-Paper-Scissors",
  1: "Dice Roll",
  2: "Strategy Battle",
  3: "Coin Flip",
};

export const MOVE_NAMES: Record<number, string[]> = {
  0: ["Rock", "Paper", "Scissors"],
  3: ["Heads", "Tails"],
};

const RPS_ALIASES: Record<string, number> = {
  rock: 0,
  r: 0,
  "0": 0,
  paper: 1,
  p: 1,
  "1": 1,
  scissors: 2,
  scissor: 2,
  s: 2,
  "2": 2,
};

/** Parse rock/paper/scissors or 0/1/2 into a move index. */
export function parseRpsToken(raw: string): number {
  const key = raw.trim().toLowerCase();
  const move = RPS_ALIASES[key];
  if (move == null) {
    throw new Error(`Invalid RPS move "${raw}" — use rock, paper, scissors, or 0/1/2`);
  }
  return move;
}
