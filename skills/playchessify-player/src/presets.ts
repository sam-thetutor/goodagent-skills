import type { CoachEngine } from "./engine.js";

export type StrategyPreset =
  | "beginner"
  | "balanced"
  | "aggressive"
  | "positional"
  | "tactical"
  | "endgame_grind"
  | "custom";

const PRESETS: Record<Exclude<StrategyPreset, "custom">, CoachEngine> = {
  beginner: {
    depth: 1,
    topK: 5,
    temperature: 0.85,
    style: { kingAttack: 0.4, sacrifice: 0.5, positional: 0.2, simplify: 0.3, forcing: 0.5 },
  },
  balanced: {
    depth: 2,
    topK: 3,
    temperature: 0.35,
    style: { kingAttack: 0.5, sacrifice: 0.45, positional: 0.7, simplify: 0.55, forcing: 0.55 },
  },
  aggressive: {
    depth: 2,
    topK: 3,
    temperature: 0.45,
    style: { kingAttack: 0.85, sacrifice: 0.75, positional: 0.4, simplify: 0.3, forcing: 0.85 },
  },
  positional: {
    depth: 2,
    topK: 3,
    temperature: 0.35,
    style: { kingAttack: 0.5, sacrifice: 0.4, positional: 0.85, simplify: 0.6, forcing: 0.55 },
  },
  tactical: {
    depth: 2,
    topK: 4,
    temperature: 0.35,
    style: { kingAttack: 0.85, sacrifice: 0.9, positional: 0.4, simplify: 0.3, forcing: 0.9 },
  },
  endgame_grind: {
    depth: 3,
    topK: 1,
    temperature: 0.05,
    style: { kingAttack: 0.4, sacrifice: 0.3, positional: 0.9, simplify: 0.9, forcing: 0.45 },
  },
};

function numEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveEngine(): { preset: StrategyPreset; engine: CoachEngine } {
  const raw = (process.env.STRATEGY_PRESET ?? "balanced").trim().toLowerCase();
  const preset = (raw in PRESETS ? raw : "balanced") as Exclude<StrategyPreset, "custom">;

  if (raw === "custom") {
    return {
      preset: "custom",
      engine: {
        depth: Math.min(3, Math.max(1, numEnv("ENGINE_DEPTH", 2))),
        topK: Math.min(5, Math.max(1, numEnv("ENGINE_TOP_K", 3))),
        temperature: Math.min(1, Math.max(0, numEnv("ENGINE_TEMPERATURE", 0.35))),
        style: {
          kingAttack: numEnv("STYLE_KING_ATTACK", 0.5),
          sacrifice: numEnv("STYLE_SACRIFICE", 0.45),
          positional: numEnv("STYLE_POSITIONAL", 0.7),
          simplify: numEnv("STYLE_SIMPLIFY", 0.55),
          forcing: numEnv("STYLE_FORCING", 0.55),
        },
      },
    };
  }

  return { preset, engine: PRESETS[preset] };
}

export function presetLabel(preset: StrategyPreset): string {
  return preset;
}
