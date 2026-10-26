// Banco de perguntas em memória: validação, etiquetas e filtros.
// Não lê arquivos — quem carrega os JSON é server/bankLoader.js.

import { DIFFICULTY_LABELS, TYPE_LABELS } from './config.js';
import { compactKey } from './normalize.js';
import { applyFilters, tagKey } from './filters.js';

const MEDIA_TYPES = ['image', 'text', 'emoji', 'none'];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);

/** Lista de problemas de uma pergunta (vazia = válida). */
export function validateQuestion(q, { categoryIds } = {}) {
  const errors = [];
  if (!q || typeof q !== 'object') return ['não é um objeto'];
  if (!isNonEmptyString(q.id)) errors.push('id ausente');
  if (!isNonEmptyString(q.category)) errors.push('categoria ausente');
  else if (categoryIds && !categoryIds.has(q.category)) errors.push(`categoria desconhecida: ${q.category}`);
  if (!(q.type in TYPE_LABELS)) errors.push(`tipo inválido: ${q.type}`);
  if (!Number.isInteger(q.difficulty) || !(q.difficulty in DIFFICULTY_LABELS)) {
    errors.push(`dificuldade inválida: ${q.difficulty} (use 1 a 4)`);
  }
  if (!isNonEmptyString(q.prompt)) errors.push('enunciado (prompt) ausente');
  if (!isStringArray(q.answers) || q.answers.length === 0) errors.push('é preciso ao menos uma resposta');
  else if (q.answers.some((a) => !compactKey(a))) errors.push('resposta vazia após normalização');
  for (const field of ['acceptedAliases', 'rejectedAnswers', 'hints', 'tags']) {
    if (q[field] !== undefined && !isStringArray(q[field])) errors.push(`${field} deve ser uma lista de textos`);
  }
  if (Array.isArray(q.hints) && q.hints.length > 3) errors.push('no máximo 3 pistas');

  const media = q.media;
  if (!media || !MEDIA_TYPES.includes(media.type)) {
    errors.push('mídia ausente ou de tipo inválido');
  } else if (media.type === 'image') {
    if (!isNonEmptyString(media.file)) errors.push('imagem sem arquivo (rode npm run fetch:media)');
    if (!isNonEmptyString(media.alt)) errors.push('imagem sem texto alternativo (alt)');
  } else if (media.type !== 'none' && !isNonEmptyString(media.text)) {
    errors.push('mídia de texto/emoji sem conteúdo');
  }

  // Nada exibido antes da revelação pode conter a resposta.
  if (Array.isArray(q.answers)) {
    const visible = [q.prompt, media?.text, media?.alt, media?.fallbackText].filter(isNonEmptyString);
    const leaked = q.answers.find((a) => {
      const key = compactKey(a);
      return key.length >= 4 && visible.some((text) => compactKey(text).includes(key));
    });
    if (leaked) errors.push(`o enunciado/mídia revela a resposta "${leaked}"`);
  }
  return errors;
}

export class QuestionBank {
  /**
   * @param {object[]} questions
   * @param {object} options
   * @param {{id: string, label: string, emoji?: string}[]} options.categories
   * @param {(file: string) => boolean} [options.mediaExists]
   */
  constructor(questions, { categories, mediaExists = () => true } = {}) {
    this.categories = categories ?? [];
    this.categoryById = new Map(this.categories.map((c) => [c.id, c]));
    this.questions = [];
    this.rejected = [];
    this.warnings = [];
    this.byId = new Map();
    this.tagKeyCache = new Map();

    const categoryIds = new Set(this.categoryById.keys());
    for (const raw of questions) {
      const errors = validateQuestion(raw, { categoryIds });
      if (raw?.id && this.byId.has(raw.id)) errors.push('id duplicado');
      if (errors.length) {
        this.rejected.push({ id: raw?.id ?? '(sem id)', errors });
        continue;
      }
      const question = prepare(raw);
      if (question.media.type === 'image' && !mediaExists(question.media.file)) {
        if (isNonEmptyString(question.media.fallbackText)) {
          question.media = { ...question.media, unavailable: true };
          this.warnings.push(`${question.id}: imagem ${question.media.file} não encontrada — usando pista em texto`);
        } else {
          this.rejected.push({ id: question.id, errors: [`imagem ${question.media.file} não encontrada`] });
          continue;
        }
      }
      this.questions.push(question);
      this.byId.set(question.id, question);
    }

    this.knownAnswers = new Set(this.questions.flatMap((q) => q.answers.map(compactKey)));
  }

  get size() {
    return this.questions.length;
  }

  get(id) {
    return this.byId.get(id);
  }

  categoryLabel(id) {
    return this.categoryById.get(id)?.label ?? id;
  }

  /** Etiquetas exibidas: categoria, dificuldade, tipo e as etiquetas livres. */
  tagsOf(q) {
    return [this.categoryLabel(q.category), DIFFICULTY_LABELS[q.difficulty], TYPE_LABELS[q.type], ...q.tags];
  }

  tagKeysOf(q) {
    let keys = this.tagKeyCache.get(q.id);
    if (!keys) {
      keys = new Set(this.tagsOf(q).map(tagKey));
      this.tagKeyCache.set(q.id, keys);
    }
    return keys;
  }

  /** Todas as etiquetas com a contagem de perguntas, mais usadas primeiro. */
  tagIndex() {
    const counts = new Map();
    for (const q of this.questions) {
      for (const tag of new Set(this.tagsOf(q))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  filter(filters) {
    return applyFilters(this.questions, filters, (q) => this.tagKeysOf(q));
  }
}

function prepare(raw) {
  return {
    ...raw,
    prompt: raw.prompt.trim(),
    answers: raw.answers.map((a) => a.trim()),
    acceptedAliases: raw.acceptedAliases ?? [],
    rejectedAnswers: raw.rejectedAnswers ?? [],
    hints: raw.hints ?? [],
    tags: raw.tags ?? [],
    media: { ...raw.media },
  };
}
