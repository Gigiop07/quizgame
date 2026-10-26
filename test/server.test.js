// Teste de ponta a ponta: servidor real + dois clientes WebSocket.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.js';
import { makeVariedBank } from './helpers.js';

const TIMINGS = { countdownMs: 150, autoStartMs: 100, afterMatchMs: 100, disconnectGraceMs: 200 };

class Client {
  constructor(url) {
    this.messages = [];
    this.waiters = [];
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.predicate(msg)) return true;
        w.resolve(msg);
        return false;
      });
    });
    this.opened = new Promise((resolve) => this.socket.addEventListener('open', resolve));
  }

  send(msg) {
    this.socket.send(JSON.stringify(msg));
  }

  /** Espera uma mensagem (já recebida ou futura) que satisfaça o predicado. */
  waitFor(predicate, timeoutMs = 3000) {
    const found = this.messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tempo esgotado esperando mensagem')), timeoutMs);
      this.waiters.push({ predicate, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  }

  waitForState(predicate, timeoutMs) {
    return this.waitFor((m) => m.t === 'state' && predicate(m), timeoutMs);
  }

  close() {
    this.socket.close();
  }
}

describe('servidor multiplayer', () => {
  let game;
  let bank;
  let base;

  before(async () => {
    bank = makeVariedBank(2);
    game = createGameServer({ bank, mediaDir: '.', timings: TIMINGS });
    const { port } = await game.listen(0, '127.0.0.1');
    base = `127.0.0.1:${port}`;
  });

  after(async () => {
    await game.close();
  });

  test('serve a página e recusa caminhos fora da pasta pública', async () => {
    const page = await fetch(`http://${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Na Lata!/);
    const core = await fetch(`http://${base}/core/rules.js`);
    assert.equal(core.status, 200);
    const escape = await fetch(`http://${base}/..%2F..%2Fdata%2Fcategories.json`);
    assert.notEqual(escape.status, 200);
    const media = await fetch(`http://${base}/m/naoexiste`);
    assert.equal(media.status, 404);
  });

  test('sala inexistente responde com erro', async () => {
    const c = new Client(`ws://${base}/ws`);
    await c.opened;
    c.send({ t: 'hello', room: 'ZZZZ', name: 'X' });
    const error = await c.waitFor((m) => m.t === 'error');
    assert.equal(error.code, 'room_not_found');
  });

  test('dois jogadores recebem a mesma pergunta, com o mesmo tempo oficial, e a pontuação é consistente', async () => {
    const ana = new Client(`ws://${base}/ws`);
    await ana.opened;
    ana.send({ t: 'hello', create: true, name: 'Ana' });
    const welcome = await ana.waitFor((m) => m.t === 'welcome');

    const bia = new Client(`ws://${base}/ws`);
    await bia.opened;
    bia.send({ t: 'hello', room: welcome.room, name: 'Bia' });
    await bia.waitFor((m) => m.t === 'welcome');

    ana.send({ t: 'joinGame' });
    bia.send({ t: 'joinGame' });

    const [qa, qb] = await Promise.all([
      ana.waitForState((s) => s.match?.phase === 'question'),
      bia.waitForState((s) => s.match?.phase === 'question'),
    ]);
    assert.equal(qa.match.question.prompt, qb.match.question.prompt);
    assert.equal(qa.match.question.startsAt, qb.match.question.startsAt);
    assert.equal(qa.match.question.endsAt, qb.match.question.endsAt);

    // o servidor conhece a resposta; os clientes não
    const round = game.manager.get(welcome.room).match.current;
    const answer = round.question.answers[0];
    assert.equal(JSON.stringify(qb).includes(answer), false);

    // ping/pong para sincronizar relógio
    ana.send({ t: 'ping', clientTime: 123 });
    const pong = await ana.waitFor((m) => m.t === 'pong');
    assert.equal(pong.clientTime, 123);
    assert.ok(Math.abs(pong.serverTime - Date.now()) < 1000);

    ana.send({ t: 'answer', text: 'chute errado' });
    const wrong = await ana.waitFor((m) => m.t === 'guessResult');
    assert.equal(wrong.result, 'incorrect');

    bia.send({ t: 'answer', text: answer });
    const right = await bia.waitFor((m) => m.t === 'guessResult' && m.result === 'correct');
    assert.equal(right.points, 10);
    assert.equal(right.isFirst, true);

    // ambos veem o mesmo placar
    const seenByAna = await ana.waitForState((s) => s.players.some((p) => p.name === 'Bia' && p.score === 10));
    const anaCard = seenByAna.players.find((p) => p.name === 'Ana');
    assert.equal(anaCard.score, 0);
    assert.equal(anaCard.round.lastGuess, 'chute errado');

    ana.send({ t: 'answer', text: answer });
    await ana.waitFor((m) => m.t === 'guessResult' && m.result === 'correct');
    const reveal = await bia.waitForState((s) => s.match?.phase === 'reveal');
    assert.equal(reveal.match.reveal.answer, answer);
    assert.equal(reveal.match.reveal.correctCount, 2);
    const scores = Object.fromEntries(reveal.players.map((p) => [p.name, p.score]));
    assert.equal(scores.Bia, 10);
    assert.ok(scores.Ana >= 1 && scores.Ana <= 9);

    ana.close();
    bia.close();
  });
});
