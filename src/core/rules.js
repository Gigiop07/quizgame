// Regras configuráveis de uma sala (o painel "Editar regras").

import { MODES, getMode } from './modes.js';
import { SCORING_MODES } from './scoring.js';
import { sanitizeFilters } from './filters.js';

export const RULE_DEFS = Object.freeze({
  mode: { type: 'enum', values: Object.keys(MODES), default: 'classico' },
  rounds: { type: 'int', min: 3, max: 50, default: 10 },
  scoreGoal: { type: 'int', min: 10, max: 500, default: 100 },
  lives: { type: 'int', min: 1, max: 10, default: 3 },
  scoring: { type: 'enum', values: Object.keys(SCORING_MODES), default: 'speed' },
  decaySeconds: { type: 'int', min: 1, max: 30, default: 10 },
  durationMode: { type: 'enum', values: ['difficulty', 'fixed'], default: 'difficulty' },
  duration: { type: 'int', min: 5, max: 60, default: 20 },
  attempts: { type: 'enum', values: ['unlimited', 'single'], default: 'unlimited' },
  shortcuts: { type: 'bool', default: true },
  typoTolerance: { type: 'bool', default: true },
  showGuesses: { type: 'bool', default: true },
  hints: { type: 'bool', default: true },
  maxHints: { type: 'int', min: 1, max: 3, default: 3 },
  hintPenalty: { type: 'int', min: 0, max: 5, default: 1 },
  minPlayers: { type: 'int', min: 1, max: 16, default: 2 },
  revealSeconds: { type: 'int', min: 2, max: 20, default: 6 },
  filters: { type: 'filters', default: [] },
});

export function defaultRules() {
  return Object.fromEntries(Object.entries(RULE_DEFS).map(([k, def]) => [k, structuredClone(def.default)]));
}

function sanitizeValue(def, value, fallback) {
  switch (def.type) {
    case 'enum':
      return def.values.includes(value) ? value : fallback;
    case 'bool':
      return typeof value === 'boolean' ? value : fallback;
    case 'int': {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : fallback;
    }
    case 'filters':
      return sanitizeFilters(value);
    default:
      return fallback;
  }
}

/** Aplica `changes` sobre `current`, ignorando chaves desconhecidas e limitando valores. */
export function sanitizeRules(changes, current = defaultRules()) {
  const next = { ...current };
  if (!changes || typeof changes !== 'object') return next;
  for (const [key, value] of Object.entries(changes)) {
    const def = RULE_DEFS[key];
    if (def) next[key] = sanitizeValue(def, value, current[key]);
  }
  return next;
}

/** Resumo curto exibido acima do palco: "Clássico (10 rodadas)". */
export function describeRules(rules) {
  const mode = getMode(rules.mode);
  const detail = {
    rounds: `${rules.rounds} rodadas`,
    score: `${rules.scoreGoal} pontos`,
    lives: `${rules.lives} ${rules.lives === 1 ? 'vida' : 'vidas'}`,
  }[mode.end];
  return `${mode.name} (${detail})`;
}
