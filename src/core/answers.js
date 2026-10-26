// Validação de respostas: comparação exata após normalização, apelidos ("atalhos")
// e uma tolerância pequena e limitada a erros de digitação.

import { answerKey, compactKey, digitsOf } from './normalize.js';

export const MATCH = Object.freeze({
  EXACT: 'exact', // bate com uma resposta cadastrada
  ALIAS: 'alias', // bate com um atalho/apelido cadastrado
  TYPO: 'typo', // aceita por erro de digitação pequeno
  NEAR: 'near', // incorreta, mas muito próxima ("quase!")
  NONE: 'none',
  EMPTY: 'empty',
});

/** Quantos erros de digitação são tolerados para uma resposta com `length` letras. */
export function allowedTypos(length) {
  if (length < 6) return 0;
  if (length <= 10) return 1;
  return 2;
}

/** Distância de Damerau-Levenshtein (com transposição de letras vizinhas). */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const keyCache = new WeakMap();

/** Chaves de comparação pré-calculadas de uma pergunta. */
export function answerKeys(question) {
  let keys = keyCache.get(question);
  if (!keys) {
    const toKeys = (list) => [...new Set((list ?? []).map(compactKey).filter(Boolean))];
    keys = {
      answers: toKeys(question.answers),
      aliases: toKeys(question.acceptedAliases),
      rejected: new Set(toKeys(question.rejectedAnswers)),
    };
    keyCache.set(question, keys);
  }
  return keys;
}

/**
 * Verifica uma tentativa.
 * @param {object} question
 * @param {string} guess
 * @param {object} [options]
 * @param {boolean} [options.shortcuts=true] aceitar `acceptedAliases`
 * @param {boolean} [options.typoTolerance=true] aceitar erros pequenos de digitação
 * @param {Set<string>} [options.knownAnswers] respostas de todo o banco (compactKey):
 *   um palpite que é resposta exata de outra pergunta nunca é aceito como erro de digitação
 *   (evita "Zâmbia" valer por "Gâmbia").
 * @returns {{ correct: boolean, match: string }}
 */
export function checkAnswer(question, guess, options = {}) {
  const { shortcuts = true, typoTolerance = true, knownAnswers } = options;
  const key = compactKey(guess ?? '');
  if (!key) return { correct: false, match: MATCH.EMPTY };

  const keys = answerKeys(question);
  if (keys.rejected.has(key)) return { correct: false, match: MATCH.NONE };
  if (keys.answers.includes(key)) return { correct: true, match: MATCH.EXACT };
  if (shortcuts && keys.aliases.includes(key)) return { correct: true, match: MATCH.ALIAS };

  const candidates = shortcuts ? [...keys.answers, ...keys.aliases] : keys.answers;
  const fuzzyAllowed = question.fuzzy !== false && !knownAnswers?.has(key);
  let near = false;

  for (const candidate of candidates) {
    if (digitsOf(candidate) !== digitsOf(key)) continue;
    const limit = allowedTypos(candidate.length);
    const distance = editDistance(key, candidate, limit + 1);
    if (fuzzyAllowed && typoTolerance && distance <= limit) {
      return { correct: true, match: MATCH.TYPO };
    }
    if (candidate.length >= 5 && distance <= limit + 1) near = true;
  }
  return { correct: false, match: near ? MATCH.NEAR : MATCH.NONE };
}

/** Verdadeiro se a mensagem de chat contém uma resposta aceita (para esconder spoilers). */
export function containsAnswer(question, message) {
  const text = ` ${answerKey(message)} `;
  const compactText = compactKey(message);
  const all = [...(question.answers ?? []), ...(question.acceptedAliases ?? [])];
  return all.some((answer) => {
    const key = answerKey(answer);
    if (!key) return false;
    if (text.includes(` ${key} `)) return true;
    const compact = key.replace(/ /g, '');
    return compact.length >= 6 && compactText.includes(compact);
  });
}
