// Normalização de texto para comparar respostas em português.

const LEADING_ARTICLES = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'the']);

/**
 * Minúsculas, sem acentos, sem pontuação e com espaços simples.
 * "  Homem-Aranha! " → "homem aranha"
 */
export function normalizeText(input) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Texto normalizado sem artigo inicial: "O Rei Leão" → "rei leao". */
export function answerKey(input) {
  const words = normalizeText(input).split(' ').filter(Boolean);
  if (words.length > 1 && LEADING_ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

/** Chave usada na comparação: ignora também os espaços ("spider man" = "spiderman"). */
export function compactKey(input) {
  return answerKey(input).replace(/ /g, '');
}

export function digitsOf(key) {
  return key.replace(/\D+/g, '');
}
