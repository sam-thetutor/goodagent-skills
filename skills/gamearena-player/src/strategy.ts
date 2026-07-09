import { randomInt } from "node:crypto";

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

const MOVE_NAMES: Record<number, string[]> = {
  0: ["Rock", "Paper", "Scissors"],
  3: ["Heads", "Tails"],
};

/**
 * Pick a move. MARKOV models repeat opponents with a Markov-chain predictor,
 * so for RPS the unexploitable strategy is uniform randomness (crypto RNG,
 * not Math.random, so there is genuinely no seedable pattern). Coin Flip is
 * pure chance either way.
 */
export function pickMove(gameType: number): { move: number; label: string } {
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
