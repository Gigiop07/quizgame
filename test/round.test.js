import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine, InvalidTransitionError, ROUND_STATE, ROUND_TRANSITIONS, PLAYER_STATE } from '../src/core/stateMachine.js';
import { Round, GUESS, OUTCOME } from '../src/core/round.js';
import { makeQuestion, rules } from './helpers.js';

const T0 = 1_000_000;

function newRound({ ruleOverrides = {}, players = ['ana', 'bia'], question } = {}) {
  const round = new Round({
    question: question ?? makeQuestion({ answers: ['Cristo Redentor'] }),
    index: 0,
    playerIds: players,
    durationMs: 20_000,
    rules: rules(ruleOverrides),
  });
  round.start(T0);
  return round;
}

describe('máquina de estados', () => {
  test('segue o fluxo válido da rodada', () => {
    const m = new StateMachine(ROUND_TRANSITIONS, ROUND_STATE.READY);
    m.to(ROUND_STATE.QUESTION_ACTIVE);
    m.to(ROUND_STATE.TIME_EXPIRED);
    m.to(ROUND_STATE.ANSWER_REVEALED);
    m.to(ROUND_STATE.ROUND_COMPLETE);
    assert.deepEqual(m.history, ['READY', 'QUESTION_ACTIVE', 'TIME_EXPIRED', 'ANSWER_REVEALED', 'ROUND_COMPLETE']);
  });

  test('impede transições inválidas', () => {
    const m = new StateMachine(ROUND_TRANSITIONS, ROUND_STATE.READY);
    assert.throws(() => m.to(ROUND_STATE.ANSWER_REVEALED), InvalidTransitionError);
    m.to(ROUND_STATE.QUESTION_ACTIVE);
    assert.throws(() => m.to(ROUND_STATE.ROUND_COMPLETE), InvalidTransitionError);
    assert.equal(m.state, ROUND_STATE.QUESTION_ACTIVE);
  });

  test('a rodada não pode ser revelada antes de fechar nem iniciada duas vezes', () => {
    const round = newRound();
    assert.throws(() => round.reveal(), InvalidTransitionError);
    assert.throws(() => round.start(T0), InvalidTransitionError);
  });
});

describe('rodada', () => {
  test('acerto: QUESTION_ACTIVE → ANSWER_SUBMITTED → ANSWER_CORRECT → ANSWER_REVEALED → ROUND_COMPLETE', () => {
    const round = newRound();
    const result = round.submit('ana', 'cristo redentor', T0 + 3000);
    assert.equal(result.result, GUESS.CORRECT);
    assert.equal(result.points, 10);
    round.close('time', T0 + 20_000);
    round.reveal();
    round.complete();
    assert.deepEqual(round.players.get('ana').machine.history, [
      PLAYER_STATE.READY,
      PLAYER_STATE.QUESTION_ACTIVE,
      PLAYER_STATE.ANSWER_SUBMITTED,
      PLAYER_STATE.ANSWER_CORRECT,
      PLAYER_STATE.ANSWER_REVEALED,
      PLAYER_STATE.ROUND_COMPLETE,
    ]);
  });

  test('erro com tentativas ilimitadas volta para QUESTION_ACTIVE e preserva o tempo', () => {
    const round = newRound();
    const endsAt = round.endsAt;
    const wrong = round.submit('ana', 'Pão de Açúcar', T0 + 1000);
    assert.equal(wrong.result, GUESS.INCORRECT);
    assert.equal(wrong.canRetry, true);
    assert.equal(round.players.get('ana').machine.state, PLAYER_STATE.QUESTION_ACTIVE);
    assert.equal(round.endsAt, endsAt);
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 2000).result, GUESS.CORRECT);
  });

  test('tentativa única trava o jogador após o erro', () => {
    const round = newRound({ ruleOverrides: { attempts: 'single' } });
    assert.equal(round.submit('ana', 'errado', T0 + 1000).result, GUESS.INCORRECT);
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 2000).result, GUESS.LOCKED);
    assert.equal(round.playerStatus('ana'), 'locked');
  });

  test('resposta vazia não muda nada', () => {
    const round = newRound();
    assert.equal(round.submit('ana', '   ', T0 + 1000).result, GUESS.EMPTY);
    assert.equal(round.players.get('ana').guesses.length, 0);
  });

  test('resposta depois do fim do tempo não pontua', () => {
    const round = newRound();
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 20_000).result, GUESS.LATE);
    round.close('time', T0 + 20_000);
    assert.equal(round.submit('bia', 'Cristo Redentor', T0 + 20_001).result, GUESS.CLOSED);
    assert.equal(round.outcomeOf('ana').points, 0);
  });

  test('tempo esgotado leva quem não acertou para TIME_EXPIRED', () => {
    const round = newRound();
    round.submit('ana', 'Cristo Redentor', T0 + 1000);
    round.close('time', T0 + 20_000);
    assert.equal(round.state, ROUND_STATE.TIME_EXPIRED);
    assert.equal(round.players.get('bia').machine.state, PLAYER_STATE.TIME_EXPIRED);
    assert.equal(round.outcomeOf('bia').status, OUTCOME.UNANSWERED);
  });

  test('pontuação do segundo jogador depende do tempo após o primeiro acerto', () => {
    const round = newRound({ players: ['ana', 'bia', 'caio'] });
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 2000).points, 10);
    assert.equal(round.submit('bia', 'Cristo Redentor', T0 + 2100).points, 9);
    assert.equal(round.submit('caio', 'Cristo Redentor', T0 + 7000).points, 5);
  });

  test('todos resolvidos permite fechar a rodada mais cedo', () => {
    const round = newRound();
    round.submit('ana', 'Cristo Redentor', T0 + 1000);
    assert.equal(round.allResolved(['ana', 'bia']), false);
    round.submit('bia', 'Cristo Redentor', T0 + 2000);
    assert.equal(round.allResolved(['ana', 'bia']), true);
    round.close('all_answered', T0 + 2000);
    assert.equal(round.state, ROUND_STATE.ALL_ANSWERED);
  });

  test('pistas: penalidade aplicada uma vez por pista usada', () => {
    const round = newRound();
    assert.equal(round.useHint('ana', T0 + 500).hint, 'Primeira pista');
    assert.equal(round.useHint('ana', T0 + 600).hint, 'Segunda pista');
    assert.deepEqual(round.hintsShownTo('ana'), ['Primeira pista', 'Segunda pista']);
    assert.deepEqual(round.hintsShownTo('bia'), []);
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 1000).points, 8);
  });

  test('pistas respeitam o limite e podem ser desativadas', () => {
    const limited = newRound({ ruleOverrides: { maxHints: 1 } });
    assert.ok(limited.useHint('ana', T0 + 1).hint);
    assert.equal(limited.useHint('ana', T0 + 2).error, 'no_more_hints');

    const off = newRound({ ruleOverrides: { hints: false } });
    assert.equal(off.useHint('ana', T0 + 1).error, 'disabled');
    assert.equal(off.hintsAvailable, 0);

    const none = newRound({ question: makeQuestion({ answers: ['X'], hints: [] }) });
    assert.equal(none.useHint('ana', T0 + 1).error, 'no_more_hints');
  });

  test('pista não altera a resposta correta', () => {
    const round = newRound();
    round.useHint('ana', T0 + 1);
    assert.equal(round.submit('ana', 'Primeira pista', T0 + 2).result, GUESS.INCORRECT);
    assert.equal(round.submit('ana', 'Cristo Redentor', T0 + 3).result, GUESS.CORRECT);
  });

  test('falha de imagem sem alternativa cancela a rodada para o jogador', () => {
    const question = makeQuestion({
      type: 'image',
      answers: ['Capivara'],
      media: { type: 'image', file: 'x.jpg', alt: 'Foto de um animal' },
    });
    const round = newRound({ question });
    round.markMediaFailed('ana');
    round.submit('ana', 'tamanduá', T0 + 1000);
    round.close('time', T0 + 20_000);
    assert.equal(round.outcomeOf('ana').status, OUTCOME.CANCELLED);
    assert.equal(round.outcomeOf('bia').status, OUTCOME.UNANSWERED);
  });

  test('com pista em texto, a falha de imagem não cancela', () => {
    const question = makeQuestion({
      type: 'image',
      answers: ['Capivara'],
      media: { type: 'image', file: 'x.jpg', alt: 'Foto de um animal', fallbackText: 'Maior roedor do mundo' },
    });
    const round = newRound({ question });
    round.markMediaFailed('ana');
    round.submit('ana', 'tamanduá', T0 + 1000);
    round.close('time', T0 + 20_000);
    assert.equal(round.outcomeOf('ana').status, OUTCOME.WRONG);
  });
});
