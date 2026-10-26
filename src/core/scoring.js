// Pontuação de 1 a 10 por rodada.
//
// "speed": o primeiro a acertar ganha `maxPoints` (10). A partir desse momento começa a
// contar o tempo: quem acertar depois ganha de `maxPoints - 1` (9) até `minPoints` (1),
// caindo conforme o tempo decorrido desde o primeiro acerto (não pela posição).
// Duas respostas próximas no tempo recebem pontuações próximas.
//
// "flat": todo acerto vale `maxPoints`.
//
// Em ambos, cada pista usada desconta `hintPenalty`, sem nunca deixar um acerto abaixo de
// `minPoints`. O multiplicador do modo (ex.: Especialista ×2) é aplicado no final.

import { SCORING } from './config.js';

// Recebem o progresso do decaimento (0 → 1) e devolvem a fração de pontos já perdida.
export const DECAY_CURVES = Object.freeze({
  linear: (t) => t,
  // perde pontos mais rápido logo após o primeiro acerto
  acelerada: (t) => 1 - (1 - t) ** 2,
});

export const SCORING_MODES = Object.freeze({
  speed: 'Respostas mais rápidas dão mais pontos',
  flat: 'Toda resposta correta vale o mesmo',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Pontos pela velocidade, antes de pistas e multiplicador.
 * @param {object} p
 * @param {boolean} p.isFirst primeiro jogador a acertar na rodada
 * @param {number} p.msSinceFirst ms entre o primeiro acerto e este (0 para o primeiro)
 * @param {number} p.decaySeconds intervalo em que a pontuação cai de max-1 até min
 */
export function speedPoints({
  isFirst,
  msSinceFirst = 0,
  decaySeconds,
  maxPoints = SCORING.maxPoints,
  minPoints = SCORING.minPoints,
  curve = SCORING.curve,
}) {
  if (isFirst) return maxPoints;
  const start = Math.max(minPoints, maxPoints - 1);
  const window = Math.max(1, decaySeconds * 1000);
  const progress = clamp(msSinceFirst / window, 0, 1);
  const lost = (DECAY_CURVES[curve] ?? DECAY_CURVES.linear)(progress);
  return clamp(Math.round(start - (start - minPoints) * lost), minPoints, start);
}

/** Pontuação final de um acerto. Nunca menor que `minPoints` × multiplicador. */
export function scoreCorrectAnswer({
  scoring = 'speed',
  isFirst,
  msSinceFirst = 0,
  decaySeconds = 10,
  hintsUsed = 0,
  hintPenalty = 1,
  multiplier = 1,
  maxPoints = SCORING.maxPoints,
  minPoints = SCORING.minPoints,
  curve = SCORING.curve,
}) {
  const base =
    scoring === 'flat'
      ? maxPoints
      : speedPoints({ isFirst, msSinceFirst, decaySeconds, maxPoints, minPoints, curve });
  const afterHints = Math.max(minPoints, base - Math.max(0, hintsUsed) * Math.max(0, hintPenalty));
  return Math.round(afterHints * multiplier);
}
