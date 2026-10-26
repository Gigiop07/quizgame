import { QuestionBank } from '../src/core/questionBank.js';
import { defaultRules } from '../src/core/rules.js';

export const CATEGORIES = [
  { id: 'cinema_tv', label: 'Cinema e TV', emoji: '🎬' },
  { id: 'esportes', label: 'Futebol e Esportes', emoji: '⚽' },
  { id: 'memes', label: 'Memes e Internet', emoji: '😂' },
  { id: 'aleatorio', label: 'Conhecimento Aleatório', emoji: '🎲' },
];

let seq = 0;

export function makeQuestion(overrides = {}) {
  seq += 1;
  return {
    id: `t-${String(seq).padStart(3, '0')}`,
    category: 'aleatorio',
    type: 'clue',
    difficulty: 1,
    prompt: 'Qual é a resposta?',
    media: { type: 'text', style: 'clue', text: 'Uma pista qualquer' },
    answers: [`Resposta ${seq}`],
    acceptedAliases: [],
    hints: ['Primeira pista', 'Segunda pista', 'Terceira pista'],
    tags: ['brasil'],
    source: { url: 'https://pt.wikipedia.org/wiki/Teste', attribution: 'teste' },
    ...overrides,
  };
}

export function makeBank(questions, options = {}) {
  return new QuestionBank(questions, { categories: CATEGORIES, ...options });
}

/** Banco variado: `perCell` perguntas para cada combinação de categoria × dificuldade. */
export function makeVariedBank(perCell = 2) {
  const questions = [];
  for (const { id: category } of CATEGORIES) {
    for (const difficulty of [1, 2, 3, 4]) {
      for (let i = 0; i < perCell; i++) questions.push(makeQuestion({ category, difficulty }));
    }
  }
  return makeBank(questions);
}

export function rules(overrides = {}) {
  return { ...defaultRules(), ...overrides };
}

/** Gerador pseudoaleatório determinístico (mulberry32) para testes reprodutíveis. */
export function seededRng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
