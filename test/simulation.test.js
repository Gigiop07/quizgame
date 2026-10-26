// Simula partidas inteiras com o banco de perguntas real, em todos os modos.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../src/core/clock.js';
import { Match, MATCH_PHASE, END_REASON } from '../src/core/match.js';
import { MODES } from '../src/core/modes.js';
import { checkAnswer } from '../src/core/answers.js';
import { loadQuestionBank } from '../server/bankLoader.js';
import { rules, seededRng } from './helpers.js';

const { bank } = loadQuestionBank();

function simulate(mode, seed, ruleOverrides = {}) {
  const clock = new ManualClock();
  const rng = seededRng(seed);
  const r = rules({ mode, ...ruleOverrides });
  const match = new Match({
    bank,
    questions: bank.filter(r.filters),
    rules: r,
    players: [
      { id: 'ana', name: 'Ana' },
      { id: 'bia', name: 'Bia' },
    ],
    clock,
    rng,
  });
  match.start();
  let handled = null;
  for (let guard = 0; match.phase !== MATCH_PHASE.FINISHED && guard < 20_000; guard++) {
    clock.advance(500);
    if (match.phase !== MATCH_PHASE.QUESTION || handled === match.current) continue;
    handled = match.current;
    // Ana sempre acerta; Bia acerta 1 em cada 3 e no resto chuta errado uma vez
    const answer = match.current.question.answers[0];
    match.submit('ana', answer);
    match.submit('bia', rng() < 1 / 3 ? answer : 'não sei');
  }
  return match;
}

describe('simulação com o banco real', () => {
  test('o banco tem perguntas suficientes para a partida clássica em cada categoria', () => {
    for (const category of bank.categories) {
      const pool = bank.filter([{ tag: category.label, op: 'union' }]);
      assert.ok(pool.length >= 10, `${category.label}: ${pool.length}`);
    }
  });

  test('a resposta oficial de cada pergunta é aceita pelo validador', () => {
    for (const q of bank.questions) {
      for (const answer of q.answers) {
        assert.equal(checkAnswer(q, answer, { knownAnswers: bank.knownAnswers }).correct, true, `${q.id}: ${answer}`);
      }
    }
  });

  for (const mode of Object.keys(MODES)) {
    test(`modo ${mode}: partidas terminam sem repetir perguntas`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const match = simulate(mode, seed);
        assert.equal(match.phase, MATCH_PHASE.FINISHED, `seed ${seed}`);
        const ids = match.rounds.map((round) => round.question.id);
        assert.equal(new Set(ids).size, ids.length, `pergunta repetida (seed ${seed})`);
        const answers = match.rounds.map((round) => round.question.answers[0]);
        assert.equal(new Set(answers).size, answers.length, `resposta repetida (seed ${seed})`);
        assert.equal(match.results.ranking[0].id, 'ana');
        if (mode === 'classico' || mode === 'especialista') assert.equal(match.endReason, END_REASON.COMPLETED);
        if (mode === 'especialista') assert.ok(match.rounds.every((round) => round.question.difficulty >= 3));
      }
    });
  }

  test('partidas temáticas usam só a categoria escolhida', () => {
    const match = simulate('classico', 3, { filters: [{ tag: 'Memes e Internet', op: 'union' }] });
    assert.ok(match.rounds.length === 10);
    assert.ok(match.rounds.every((round) => round.question.category === 'memes'));
  });
});
