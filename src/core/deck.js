// Seleção das perguntas de uma partida.
//   - nunca repete uma pergunta na mesma partida;
//   - evita duas perguntas com a mesma resposta (ex.: frase e foto da mesma pessoa);
//   - prefere perguntas que a sala ainda não viu (só repete quando acabam as inéditas);
//   - busca a dificuldade pedida e, se não houver, a mais próxima;
//   - equilibra as categorias e evita sequências longas da mesma categoria.

import { MAX_CATEGORY_STREAK } from './config.js';
import { compactKey } from './normalize.js';

const answerOf = (q) => compactKey(q.answers[0]);

export class QuestionDeck {
  /**
   * @param {object[]} questions perguntas já filtradas pelas regras da sala
   * @param {object} [options]
   * @param {() => number} [options.rng]
   * @param {number} [options.maxCategoryStreak]
   * @param {Set<string>} [options.seen] ids vistos em partidas anteriores
   */
  constructor(questions, { rng = Math.random, maxCategoryStreak = MAX_CATEGORY_STREAK, seen = new Set() } = {}) {
    this.pool = [...questions];
    this.rng = rng;
    this.maxCategoryStreak = maxCategoryStreak;
    this.seen = seen;
    this.used = new Set();
    this.usedAnswers = new Set();
    this.categoryHistory = [];
    this.categoryCount = new Map();
  }

  get size() {
    return this.pool.length;
  }

  get remaining() {
    return this.pool.length - this.used.size;
  }

  /** Próxima pergunta, ou `null` quando não sobra nenhuma. */
  draw(difficulty = null) {
    const unused = this.pool.filter((q) => !this.used.has(q.id));
    if (unused.length === 0) return null;
    const newAnswers = unused.filter((q) => !this.usedAnswers.has(answerOf(q)));
    const candidates = this.freshFirst(newAnswers.length ? newAnswers : unused);
    const question = this.pickBalanced(this.closestDifficulty(candidates, difficulty));
    this.used.add(question.id);
    this.usedAnswers.add(answerOf(question));
    this.categoryHistory.push(question.category);
    this.categoryCount.set(question.category, (this.categoryCount.get(question.category) ?? 0) + 1);
    return question;
  }

  freshFirst(questions) {
    const fresh = questions.filter((q) => !this.seen.has(q.id));
    return fresh.length ? fresh : questions;
  }

  closestDifficulty(questions, difficulty) {
    if (difficulty == null) return questions;
    const distance = (q) => Math.abs(q.difficulty - difficulty);
    const best = Math.min(...questions.map(distance));
    return questions.filter((q) => distance(q) === best);
  }

  pickBalanced(questions) {
    let options = questions;
    const streak = this.streakCategory();
    if (streak) {
      const others = options.filter((q) => q.category !== streak);
      if (others.length) options = others;
    }
    const uses = (q) => this.categoryCount.get(q.category) ?? 0;
    const fewest = Math.min(...options.map(uses));
    options = options.filter((q) => uses(q) === fewest);
    return options[Math.floor(this.rng() * options.length)];
  }

  /** Categoria que já apareceu `maxCategoryStreak` vezes seguidas (ou null). */
  streakCategory() {
    const recent = this.categoryHistory.slice(-this.maxCategoryStreak);
    if (recent.length < this.maxCategoryStreak) return null;
    return recent.every((c) => c === recent[0]) ? recent[0] : null;
  }
}
