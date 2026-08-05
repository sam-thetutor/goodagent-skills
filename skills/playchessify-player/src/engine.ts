import { Chess, type Move } from "chess.js";

export interface StyleWeights {
  kingAttack: number;
  sacrifice: number;
  positional: number;
  simplify: number;
  forcing: number;
}

export interface CoachEngine {
  depth: number;
  topK: number;
  temperature: number;
  style: StyleWeights;
}

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const TABLES: Record<string, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

function squareValue(type: string, color: "w" | "b", row: number, col: number): number {
  const table = TABLES[type];
  if (!table) return 0;
  return color === "w" ? table[row][col] : table[7 - row][col];
}

function evaluateBoard(game: Chess): number {
  if (game.isCheckmate()) return game.turn() === "w" ? -Infinity : Infinity;
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition()) return 0;

  let total = 0;
  const board = game.board();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const value = (PIECE_VALUES[piece.type] || 0) + squareValue(piece.type, piece.color, row, col);
      total += piece.color === "w" ? value : -value;
    }
  }
  return total;
}

function scoreMove(m: Move): number {
  let score = 0;
  if (m.captured) score += 10 * (PIECE_VALUES[m.captured] || 0) - (PIECE_VALUES[m.piece] || 0);
  if (m.promotion) score += PIECE_VALUES[m.promotion] || 0;
  if (m.flags.includes("e")) score += 100;
  if (m.san.includes("+")) score += 50;
  if (m.san.includes("#")) score += 10000;
  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => scoreMove(b) - scoreMove(a));
}

function fileRank(square: string): [number, number] {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

function enemyKingSquare(game: Chess, coachColor: "w" | "b"): [number, number] | null {
  const enemy = coachColor === "w" ? "b" : "w";
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === "k" && p.color === enemy) return [c, 7 - r];
    }
  }
  return null;
}

function styleBonus(
  move: Move,
  game: Chess,
  coachColor: "w" | "b",
  s: StyleWeights,
  ahead: boolean,
): number {
  let b = 0;
  if (move.san.includes("#")) b += s.forcing * 60;
  else if (move.san.includes("+")) b += s.forcing * 45;
  if (move.captured) b += s.forcing * 18;
  if (move.captured && (PIECE_VALUES[move.piece] || 0) > (PIECE_VALUES[move.captured] || 0)) {
    b += s.sacrifice * 14;
  }
  const ek = enemyKingSquare(game, coachColor);
  if (ek) {
    const [tf, tr] = fileRank(move.to);
    const d = Math.max(Math.abs(tf - ek[0]), Math.abs(tr - ek[1]));
    if (d <= 2) b += s.kingAttack * (3 - d) * 18;
  }
  if (move.captured && ahead) b += s.simplify * 20;
  const [tf, tr] = fileRank(move.to);
  const central = 3.5 - Math.max(Math.abs(tf - 3.5), Math.abs(tr - 3.5));
  b += s.positional * central * 6;
  return b;
}

function minimax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
): number {
  if (depth === 0 || game.isGameOver()) return evaluateBoard(game);
  const possibleMoves = orderMoves(game.moves({ verbose: true }));
  if (isMaximizingPlayer) {
    let best = -Infinity;
    for (const move of possibleMoves) {
      game.move(move);
      best = Math.max(best, minimax(game, depth - 1, alpha, beta, false));
      game.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of possibleMoves) {
    game.move(move);
    best = Math.min(best, minimax(game, depth - 1, alpha, beta, true));
    game.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

/** Side-agnostic styled move pick (port of playchessify getCoachMove). */
export function pickMove(game: Chess, engine: CoachEngine): Move | null {
  const moves = orderMoves(game.moves({ verbose: true }));
  if (game.isGameOver() || moves.length === 0) return null;

  const coachColor = game.turn() as "w" | "b";
  const evalNow = evaluateBoard(game);
  const ahead = coachColor === "w" ? evalNow > 150 : evalNow < -150;

  const scored = moves.map((m) => {
    game.move(m);
    const val = minimax(game, engine.depth - 1, -Infinity, Infinity, coachColor === "b");
    game.undo();
    const coachVal = coachColor === "w" ? val : -val;
    return { m, score: coachVal + styleBonus(m, game, coachColor, engine.style, ahead) };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, engine.topK));
  if (engine.temperature <= 0 || top.length === 1) return top[0].m;

  const T = engine.temperature * 200;
  const max = top[0].score;
  const weights = top.map((t) => Math.exp((t.score - max) / T));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < top.length; i++) {
    r -= weights[i];
    if (r <= 0) return top[i].m;
  }
  return top[0].m;
}

export function replayMoves(sans: string[]): Chess {
  const board = new Chess();
  for (const san of sans) {
    if (!board.move(san)) throw new Error(`illegal san in history: ${san}`);
  }
  return board;
}
