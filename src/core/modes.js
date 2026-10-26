// Modos de jogo. Cada modo diz quais dificuldades usar em cada rodada, como a partida
// termina e se há multiplicador de pontos. O filtro de categorias vale para todos os modos
// (é assim que se monta uma partida temática: "só futebol", "só memes"...).

import { CLASSIC_DISTRIBUTION } from './config.js';

/**
 * Distribui `total` rodadas segundo os pesos de `distribution` (maiores restos) e devolve
 * a lista de dificuldades em ordem crescente: começa fácil, termina difícil.
 */
export function planFromDistribution(distribution, total) {
  const entries = Object.entries(distribution).map(([d, w]) => [Number(d), Math.max(0, w)]);
  const weightSum = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0 || weightSum === 0) return [];
  const shares = entries.map(([d, w]) => {
    const exact = (w / weightSum) * total;
    return { d, count: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let missing = total - shares.reduce((s, x) => s + x.count, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.d - b.d)) {
    if (missing <= 0) break;
    share.count++;
    missing--;
  }
  return shares.sort((a, b) => a.d - b.d).flatMap(({ d, count }) => Array(count).fill(d));
}

/** Sorteia uma dificuldade com os pesos dados. */
export function weightedDifficulty(weights, rng = Math.random) {
  const entries = Object.entries(weights).map(([d, w]) => [Number(d), w]);
  let roll = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [d, w] of entries) {
    roll -= w;
    if (roll < 0) return d;
  }
  return entries[entries.length - 1][0];
}

export const MODES = Object.freeze({
  classico: {
    id: 'classico',
    name: 'Clássico',
    description: 'Número fixo de rodadas, da mais fácil à mais difícil. Quem somar mais pontos vence.',
    end: 'rounds',
    multiplier: 1,
    plan: (rules) => planFromDistribution(CLASSIC_DISTRIBUTION, rules.rounds),
  },
  corrida: {
    id: 'corrida',
    name: 'Corrida de pontos',
    description: 'Rodadas sem fim até alguém atingir o objetivo de pontuação.',
    end: 'score',
    multiplier: 1,
    nextDifficulty: (_roundIndex, rng) => weightedDifficulty(CLASSIC_DISTRIBUTION, rng),
  },
  sobrevivencia: {
    id: 'sobrevivencia',
    name: 'Sobrevivência',
    description: 'Não acertou a tempo, perde uma vida. As perguntas ficam mais difíceis a cada 4 rodadas.',
    end: 'lives',
    multiplier: 1,
    nextDifficulty: (roundIndex) => Math.min(4, 1 + Math.floor(roundIndex / 4)),
  },
  especialista: {
    id: 'especialista',
    name: 'Especialista',
    description: 'Só perguntas difíceis e de especialista, valendo o dobro de pontos.',
    end: 'rounds',
    multiplier: 2,
    plan: (rules) => planFromDistribution({ 3: 3, 4: 2 }, rules.rounds),
  },
});

export function getMode(id) {
  return MODES[id] ?? MODES.classico;
}
