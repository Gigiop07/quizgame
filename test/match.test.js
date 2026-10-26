import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../src/core/clock.js';
import { Match, MATCH_PHASE, END_REASON } from '../src/core/match.js';
import { OUTCOME } from '../src/core/round.js';
import { makeQuestion, makeBank, makeVariedBank, rules, seededRng } from './helpers.js';

const TIMINGS = { countdownMs: 3000 };

function newMatch({ bank = makeVariedBank(3), ruleOverrides = {}, players = ['ana', 'bia'], seen } = {}) {
  const clock = new ManualClock();
  const events = [];
  const r = rules({ revealSeconds: 5, durationMode: 'fixed', duration: 20, ...ruleOverrides });
  const match = new Match({
    bank,
    questions: bank.filter(r.filters),
    rules: r,
    players: players.map((id) => ({ id, name: id.toUpperCase() })),
    clock,
    rng: seededRng(11),
    seen,
    timings: TIMINGS,
    onChange: (e) => events.push(e),
  });
  return { match, clock, events };
}

const answerOf = (match) => match.current.question.answers[0];

/** Avança até uma pergunta estar aberta (ou a partida acabar). */
function toQuestion(match, clock) {
  while (match.phase !== MATCH_PHASE.QUESTION && match.phase !== MATCH_PHASE.FINISHED) clock.advance(100);
}

/** Avança até a PRÓXIMA pergunta abrir (ou a partida acabar), sem pular rodadas. */
function nextQuestion(match, clock) {
  const current = match.current;
  while (match.phase !== MATCH_PHASE.FINISHED && (match.current === current || match.phase !== MATCH_PHASE.QUESTION)) {
    clock.advance(100);
  }
}

describe('partida', () => {
  test('clássico: 10 rodadas com a distribuição de dificuldade e fim correto', () => {
    const { match, clock } = newMatch();
    match.start();
    assert.equal(match.phase, MATCH_PHASE.COUNTDOWN);
    clock.advance(3000);
    assert.equal(match.phase, MATCH_PHASE.QUESTION);

    const difficulties = [];
    while (match.phase !== MATCH_PHASE.FINISHED) {
      toQuestion(match, clock);
      if (match.phase === MATCH_PHASE.FINISHED) break;
      difficulties.push(match.current.question.difficulty);
      match.submit('ana', answerOf(match));
      clock.advance(1000);
      match.submit('bia', 'resposta errada');
      nextQuestion(match, clock);
    }
    assert.deepEqual(difficulties, [1, 1, 1, 2, 2, 2, 2, 3, 3, 4]);
    assert.equal(match.endReason, END_REASON.COMPLETED);
    const ids = match.rounds.map((r) => r.question.id);
    assert.equal(new Set(ids).size, ids.length);

    const [first, second] = match.results.ranking;
    assert.equal(first.id, 'ana');
    assert.equal(first.score, 100);
    assert.equal(first.correct, 10);
    assert.equal(first.accuracy, 1);
    assert.equal(second.wrong, 10);
    assert.equal(second.accuracy, 0);
    assert.equal(match.results.questions.length, 10);
    assert.equal(match.results.questions[0].answer, match.rounds[0].question.answers[0]);
  });

  test('tempo esgotado revela e passa para a próxima rodada', () => {
    const { match, clock, events } = newMatch();
    match.start();
    clock.advance(3000);
    const first = match.current;
    clock.advance(19_999);
    assert.equal(match.phase, MATCH_PHASE.QUESTION);
    clock.advance(1);
    assert.equal(match.phase, MATCH_PHASE.REVEAL);
    assert.equal(first.state, 'ANSWER_REVEALED');
    assert.ok(events.some((e) => e.type === 'round_closed' && e.reason === 'time'));
    assert.equal(match.submit('ana', first.question.answers[0]).result, 'closed');
    clock.advance(5000);
    assert.equal(first.state, 'ROUND_COMPLETE');
    assert.equal(match.phase, MATCH_PHASE.QUESTION);
    assert.notEqual(match.current, first);
  });

  test('a rodada fecha mais cedo quando todos acertam', () => {
    const { match, clock } = newMatch();
    match.start();
    clock.advance(3000);
    match.submit('ana', answerOf(match));
    match.submit('bia', answerOf(match));
    assert.equal(match.phase, MATCH_PHASE.REVEAL);
  });

  test('pontuação acumulada usa o horário do servidor', () => {
    const { match, clock } = newMatch({ ruleOverrides: { decaySeconds: 10 } });
    match.start();
    clock.advance(3000);
    clock.advance(4000);
    match.submit('bia', answerOf(match));
    clock.advance(2500);
    match.submit('ana', answerOf(match));
    assert.equal(match.players.get('bia').score, 10);
    assert.equal(match.players.get('ana').score, 7);
  });

  test('corrida de pontos termina quando alguém atinge o objetivo', () => {
    const { match, clock } = newMatch({ ruleOverrides: { mode: 'corrida', scoreGoal: 30 } });
    match.start();
    let rounds = 0;
    while (match.phase !== MATCH_PHASE.FINISHED) {
      toQuestion(match, clock);
      if (match.phase === MATCH_PHASE.FINISHED) break;
      rounds++;
      match.submit('bia', answerOf(match));
      nextQuestion(match, clock);
    }
    assert.equal(rounds, 3);
    assert.equal(match.endReason, END_REASON.GOAL_REACHED);
    assert.equal(match.results.ranking[0].id, 'bia');
  });

  test('sobrevivência: quem erra perde vida; o último que sobra vence', () => {
    const { match, clock } = newMatch({ ruleOverrides: { mode: 'sobrevivencia', lives: 2 } });
    match.start();
    while (match.phase !== MATCH_PHASE.FINISHED) {
      toQuestion(match, clock);
      if (match.phase === MATCH_PHASE.FINISHED) break;
      match.submit('ana', answerOf(match));
      nextQuestion(match, clock);
    }
    assert.equal(match.endReason, END_REASON.LAST_SURVIVOR);
    assert.equal(match.rounds.length, 2);
    assert.equal(match.players.get('bia').eliminated, true);
    assert.equal(match.players.get('bia').eliminatedAtRound, 2);
    assert.equal(match.results.ranking[0].id, 'ana');
    assert.equal(match.results.ranking[0].bestStreak, 2);
  });

  test('sobrevivência solo termina quando as vidas acabam e as perguntas ficam mais difíceis', () => {
    const { match, clock } = newMatch({ players: ['ana'], ruleOverrides: { mode: 'sobrevivencia', lives: 1 } });
    match.start();
    const difficulties = [];
    for (let i = 0; i < 9; i++) {
      toQuestion(match, clock);
      difficulties.push(match.current.question.difficulty);
      match.submit('ana', answerOf(match));
      nextQuestion(match, clock);
    }
    assert.deepEqual(difficulties, [1, 1, 1, 1, 2, 2, 2, 2, 3]);
    toQuestion(match, clock);
    clock.advance(25_000); // deixou o tempo acabar
    assert.equal(match.phase, MATCH_PHASE.FINISHED);
    assert.equal(match.endReason, END_REASON.ALL_ELIMINATED);
  });

  test('especialista: só difíceis/especialista e pontos em dobro', () => {
    const { match, clock } = newMatch({ ruleOverrides: { mode: 'especialista', rounds: 5 } });
    match.start();
    clock.advance(3000);
    assert.ok(match.current.question.difficulty >= 3);
    assert.equal(match.submit('ana', answerOf(match)).points, 20);
  });

  test('poucas perguntas: a partida fica mais curta em vez de falhar', () => {
    const bank = makeBank([makeQuestion(), makeQuestion({ difficulty: 3 }), makeQuestion({ difficulty: 2 })]);
    const { match, clock } = newMatch({ bank, ruleOverrides: { rounds: 10 } });
    assert.equal(match.totalRounds, 3);
    match.start();
    clock.advance(200_000);
    assert.equal(match.phase, MATCH_PHASE.FINISHED);
    assert.equal(match.rounds.length, 3);
    assert.equal(match.endReason, END_REASON.OUT_OF_QUESTIONS);
  });

  test('corrida sem perguntas suficientes termina sem repetir', () => {
    const bank = makeBank([makeQuestion(), makeQuestion()]);
    const { match, clock } = newMatch({ bank, ruleOverrides: { mode: 'corrida', scoreGoal: 500 } });
    match.start();
    clock.advance(200_000);
    assert.equal(match.endReason, END_REASON.OUT_OF_QUESTIONS);
    assert.equal(match.rounds.length, 2);
  });

  test('todos saem: partida encerrada e rodada interrompida fica fora do resultado', () => {
    const { match, clock } = newMatch();
    match.start();
    clock.advance(3000);
    match.removePlayer('ana');
    assert.equal(match.phase, MATCH_PHASE.QUESTION);
    match.removePlayer('bia');
    assert.equal(match.phase, MATCH_PHASE.FINISHED);
    assert.equal(match.endReason, END_REASON.NO_PLAYERS);
    assert.equal(match.results.roundsPlayed, 0);
    clock.advance(100_000); // nenhum timer pendente dispara depois do fim
    assert.equal(match.rounds.length, 1);
  });

  test('quem entra no meio da partida participa da rodada atual', () => {
    const { match, clock } = newMatch();
    match.start();
    clock.advance(3000);
    match.addPlayer('caio', 'CAIO');
    assert.equal(match.submit('caio', answerOf(match)).result, 'correct');
  });

  test('quem sai não impede a rodada de fechar quando os demais resolvem', () => {
    const { match, clock } = newMatch();
    match.start();
    clock.advance(3000);
    match.removePlayer('bia');
    match.submit('ana', answerOf(match));
    assert.equal(match.phase, MATCH_PHASE.REVEAL);
  });

  test('resultado ignora rodadas canceladas por falha de imagem', () => {
    const image = makeQuestion({ type: 'image', media: { type: 'image', file: 'a.jpg', alt: 'Foto' }, answers: ['Alfa'] });
    const text = makeQuestion({ answers: ['Beta'], difficulty: 1 });
    const bank = makeBank([image, text]);
    const { match, clock } = newMatch({ bank, players: ['ana'], ruleOverrides: { rounds: 3 } });
    match.start();
    while (match.phase !== MATCH_PHASE.FINISHED) {
      toQuestion(match, clock);
      if (match.phase === MATCH_PHASE.FINISHED) break;
      if (match.current.question.media.type === 'image') {
        match.reportMediaError('ana');
        match.submit('ana', 'chute');
      } else {
        match.submit('ana', answerOf(match));
      }
      nextQuestion(match, clock);
    }
    const [me] = match.results.ranking;
    assert.equal(me.cancelled, 1);
    assert.equal(me.correct, 1);
    assert.equal(me.wrong, 0);
    assert.equal(me.accuracy, 1);
    const cancelled = match.results.questions.find((q) => q.answer === 'Alfa');
    assert.equal(cancelled.perPlayer.ana.status, OUTCOME.CANCELLED);
  });

  test('estatísticas finais: tempo médio, sem resposta e melhores categorias', () => {
    const { match, clock } = newMatch({ players: ['ana'], ruleOverrides: { rounds: 3 } });
    match.start();
    const times = [2000, 4000];
    for (let i = 0; i < 3; i++) {
      toQuestion(match, clock);
      if (i < 2) {
        clock.advance(times[i]);
        match.submit('ana', answerOf(match));
      }
      nextQuestion(match, clock);
    }
    const [me] = match.results.ranking;
    assert.equal(me.correct, 2);
    assert.equal(me.unanswered, 1);
    assert.equal(me.wrong, 0);
    assert.equal(me.avgResponseMs, 3000);
    assert.equal(me.accuracy, 1);
    assert.ok(me.bestCategories.length >= 1);
    assert.equal(me.bestCategories[0].correct, 1);
  });
});
