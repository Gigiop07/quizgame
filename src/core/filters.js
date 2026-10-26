// Filtros de etiquetas no estilo JKLM: ∪ (união), ∩ (interseção) e ∖ (exclusão).
//   - sem uniões, parte de todas as perguntas; com uniões, das que têm alguma delas;
//   - depois mantém só as que têm todas as interseções;
//   - por fim remove as que têm alguma exclusão.

import { normalizeText } from './normalize.js';

export const FILTER_OPS = Object.freeze(['union', 'intersection', 'exclusion']);

export function tagKey(tag) {
  return normalizeText(String(tag ?? ''));
}

/** Remove filtros inválidos ou repetidos. */
export function sanitizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const seen = new Set();
  const result = [];
  for (const f of filters) {
    if (!f || !FILTER_OPS.includes(f.op)) continue;
    const tag = String(f.tag ?? '').trim().slice(0, 40);
    const key = tagKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ tag, op: f.op });
  }
  return result.slice(0, 20);
}

/**
 * @param {object[]} questions
 * @param {{tag: string, op: string}[]} filters
 * @param {(q: object) => Set<string>} tagKeysOf etiquetas normalizadas de uma pergunta
 */
export function applyFilters(questions, filters, tagKeysOf) {
  const clean = sanitizeFilters(filters).map((f) => ({ ...f, key: tagKey(f.tag) }));
  const unions = clean.filter((f) => f.op === 'union');
  const intersections = clean.filter((f) => f.op === 'intersection');
  const exclusions = clean.filter((f) => f.op === 'exclusion');
  return questions.filter((q) => {
    const tags = tagKeysOf(q);
    if (unions.length && !unions.some((f) => tags.has(f.key))) return false;
    if (!intersections.every((f) => tags.has(f.key))) return false;
    return !exclusions.some((f) => tags.has(f.key));
  });
}
