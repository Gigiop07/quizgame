import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../src/core/clock.js';
import { Room } from '../server/room.js';
import { buildState } from '../server/views.js';
import { MediaRegistry } from '../server/mediaRegistry.js';
import { makeQuestion, makeBank, makeVariedBank, seededRng } from './helpers.js';

const TIMINGS = { countdownMs: 1000, autoStartMs: 2000, afterMatchMs: 4000, disconnectGraceMs: 5000 };

function setup(bank = makeVariedBank(2)) {
  const clock = new ManualClock();
  const room = new Room({ code: 'TEST', bank, clock, rng: seededRng(5), timings: TIMINGS, media: new MediaRegistry({ now: () => clock.now() }) });
  const inbox = new Map();
  const connect = (name, token) => {
    const messages = [];
    const member = room.join({ name, token, send: (m) => messages.push(m) });
    inbox.set(member.id, messages);
    return member;
  };
  const lastState = (id) => inbox.get(id).filter((m) => m.t === 'state').at(-1);
  const all = (id, type) => inbox.get(id).filter((m) => m.t === type);
  return { clock, room, connect, lastState, all };
}

describe('sala', () => {
  test('primeiro a entrar lidera; só o líder muda regras', () => {
    const { room, connect, lastState } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    assert.equal(room.leaderId, ana.id);
    room.handle(bia.id, { t: 'setRules', rules: { rounds: 5 } });
    assert.equal(room.rules.rounds, 10);
    room.handle(ana.id, { t: 'setRules', rules: { rounds: 5, inventada: true, duration: 999 } });
    assert.equal(room.rules.rounds, 5);
    assert.equal(room.rules.duration, 60);
    assert.equal('inventada' in room.rules, false);
    assert.equal(lastState(bia.id).room.rules.rounds, 5);
  });

  test('apelidos repetidos ganham número', () => {
    const { connect } = setup();
    connect('Ana');
    assert.equal(connect('ana').name, 'ana 2');
  });

  test('começa sozinha com jogadores suficientes e mostra "à espera" antes', () => {
    const { room, clock, connect, lastState } = setup();
    const ana = connect('Ana');
    room.handle(ana.id, { t: 'joinGame' });
    assert.equal(lastState(ana.id).room.playersNeeded, 1);
    const bia = connect('Bia');
    room.handle(bia.id, { t: 'joinGame' });
    assert.ok(lastState(ana.id).room.autoStartAt);
    clock.advance(2000);
    assert.ok(room.match);
    clock.advance(1000);
    assert.equal(room.match.phase, 'question');
  });

  test('líder pode começar sozinho (modo solo)', () => {
    const { room, clock, connect } = setup();
    const ana = connect('Ana');
    room.handle(ana.id, { t: 'startNow' });
    assert.equal(room.match, null); // ainda não entrou no jogo
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(ana.id, { t: 'startNow' });
    assert.ok(room.match);
    clock.advance(1000);
    assert.equal(room.match.phase, 'question');
  });

  test('a resposta só chega aos clientes na revelação', () => {
    const { room, clock, connect, lastState } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(bia.id, { t: 'joinGame' });
    clock.advance(3000);
    const answer = room.match.current.question.answers[0];
    const during = JSON.stringify(lastState(bia.id));
    assert.equal(during.includes(answer), false);
    assert.equal(during.includes(room.match.current.question.id), false);
    room.handle(ana.id, { t: 'answer', text: answer });
    room.handle(bia.id, { t: 'answer', text: answer });
    assert.equal(lastState(bia.id).match.reveal.answer, answer);
  });

  test('palpites errados aparecem para os outros só quando a regra permite', () => {
    const { room, clock, connect, lastState } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    room.handle(ana.id, { t: 'setRules', rules: { showGuesses: false } });
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(bia.id, { t: 'joinGame' });
    clock.advance(3000);
    room.handle(ana.id, { t: 'answer', text: 'chute errado' });
    const anaSeenByBia = lastState(bia.id).players.find((p) => p.id === ana.id);
    const anaSeenByAna = lastState(ana.id).players.find((p) => p.id === ana.id);
    assert.equal(anaSeenByBia.round.lastGuess, undefined);
    assert.equal(anaSeenByAna.round.lastGuess, 'chute errado');
  });

  test('mensagem de chat com a resposta é escondida durante a pergunta', () => {
    const { room, clock, connect, all } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(bia.id, { t: 'joinGame' });
    clock.advance(3000);
    const answer = room.match.current.question.answers[0];
    room.handle(ana.id, { t: 'chat', text: `é ${answer}!` });
    const message = all(bia.id, 'chat').at(-1).message;
    assert.equal(message.hidden, true);
    assert.equal(message.text, null);
  });

  test('pistas são enviadas só para quem pediu', () => {
    const { room, clock, connect, lastState } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(bia.id, { t: 'joinGame' });
    clock.advance(3000);
    room.handle(ana.id, { t: 'hint' });
    assert.equal(lastState(ana.id).match.me.hints.length, 1);
    assert.equal(lastState(bia.id).match.me.hints.length, 0);
  });

  test('reconexão com o token mantém o jogador e a pontuação', () => {
    const { room, clock, connect, lastState } = setup();
    const ana = connect('Ana');
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(ana.id, { t: 'startNow' });
    clock.advance(1000);
    room.handle(ana.id, { t: 'answer', text: room.match.current.question.answers[0] });
    room.disconnect(ana.id);
    clock.advance(2000);
    const again = connect('Ana', ana.token);
    assert.equal(again.id, ana.id);
    assert.equal(lastState(ana.id).players[0].score, 10);
  });

  test('desconectado por muito tempo sai da sala e a liderança passa adiante', () => {
    const { room, clock, connect } = setup();
    const ana = connect('Ana');
    const bia = connect('Bia');
    room.disconnect(ana.id);
    clock.advance(5000);
    assert.equal(room.members.has(ana.id), false);
    assert.equal(room.leaderId, bia.id);
  });

  test('imagens usam endereço temporário que não revela o arquivo', () => {
    const question = makeQuestion({ type: 'image', answers: ['Capivara'], media: { type: 'image', file: 'img-001.jpg', alt: 'Foto de um animal' } });
    const { room, clock, connect } = setup(makeBank([question]));
    const ana = connect('Ana');
    room.handle(ana.id, { t: 'joinGame' });
    room.handle(ana.id, { t: 'startNow' });
    clock.advance(1000);
    const state = buildState(room, ana.id);
    assert.match(state.match.question.media.src, /^\/m\/[0-9a-f]{24}$/);
    assert.equal(JSON.stringify(state).includes('img-001'), false);
    assert.equal(room.media.resolve(state.match.question.media.src.slice(3)), 'img-001.jpg');
  });

  test('resultado fica disponível depois da partida e nova partida começa após a pausa', () => {
    const bank = makeBank([makeQuestion(), makeQuestion(), makeQuestion()]);
    const { room, clock, connect, lastState } = setup(bank);
    const ana = connect('Ana');
    room.handle(ana.id, { t: 'setRules', rules: { minPlayers: 1, rounds: 3 } });
    room.handle(ana.id, { t: 'joinGame' });
    clock.advance(2000 + 1000);
    for (let i = 0; i < 3; i++) {
      room.handle(ana.id, { t: 'answer', text: room.match.current.question.answers[0] });
      clock.advance(6000);
    }
    assert.equal(room.match, null);
    const state = lastState(ana.id);
    assert.equal(state.results.ranking[0].score, 30);
    assert.equal(state.results.ranking[0].correct, 3);
    assert.ok(state.room.autoStartAt);
    clock.advance(4000);
    assert.ok(room.match); // recomeçou sozinha
  });
});
