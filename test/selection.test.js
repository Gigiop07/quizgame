import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QuestionDeck } from '../src/core/deck.js';
import { planFromDistribution } from '../src/core/modes.js';
import { makeQuestion, makeBank, makeVariedBank, seededRng, CATEGORIES } from './helpers.js';

describe('seleção de perguntas', () => {
  test('distribuição clássica de 10 rodadas: 3 fáceis, 4 médias, 2 difíceis, 1 especialista', () => {
    assert.deepEqual(planFromDistribution({ 1: 3, 2: 4, 3: 2, 4: 1 }, 10), [1, 1, 1, 2, 2, 2, 2, 3, 3, 4]);
  });

  test('distribuição escala para outras quantidades de rodadas', () => {
    const plan = planFromDistribution({ 1: 3, 2: 4, 3: 2, 4: 1 }, 5);
    assert.equal(plan.length, 5);
    assert.deepEqual([...plan].sort(), plan); // crescente
    assert.equal(planFromDistribution({ 1: 3, 2: 4, 3: 2, 4: 1 }, 20).length, 20);
  });

  test('nunca repete pergunta na mesma partida', () => {
    const bank = makeVariedBank(2);
    for (let seed = 1; seed <= 20; seed++) {
      const deck = new QuestionDeck(bank.questions, { rng: seededRng(seed) });
      const ids = [];
      let q;
      while ((q = deck.draw(1 + (ids.length % 4)))) ids.push(q.id);
      assert.equal(ids.length, bank.size);
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  test('evita duas perguntas com a mesma resposta na partida', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const bank = makeBank([
        makeQuestion({ answers: ['Xuxa'], type: 'quote', media: { type: 'text', style: 'quote', text: 'Beijinho, beijinho' } }),
        makeQuestion({ answers: ['Xuxa'], category: 'cinema_tv' }),
        makeQuestion({ answers: ['Faustão'] }),
      ]);
      const deck = new QuestionDeck(bank.questions, { rng: seededRng(seed) });
      const first = deck.draw(1).answers[0];
      const second = deck.draw(1).answers[0];
      assert.notEqual(first, second);
      assert.ok(deck.draw(1)); // sem alternativa, repete a resposta em vez de falhar
    }
  });

  test('respeita a dificuldade pedida quando possível', () => {
    const bank = makeVariedBank(3);
    const deck = new QuestionDeck(bank.questions, { rng: seededRng(7) });
    for (const d of [1, 1, 1, 2, 2, 2, 2, 3, 3, 4]) assert.equal(deck.draw(d).difficulty, d);
  });

  test('usa a dificuldade mais próxima quando falta a pedida', () => {
    const bank = makeBank([makeQuestion({ difficulty: 2 }), makeQuestion({ difficulty: 4 })]);
    const deck = new QuestionDeck(bank.questions);
    assert.equal(deck.draw(1).difficulty, 2);
  });

  test('equilibra categorias e evita sequências longas', () => {
    const bank = makeVariedBank(3);
    const deck = new QuestionDeck(bank.questions, { rng: seededRng(3), maxCategoryStreak: 2 });
    const categories = [];
    for (let i = 0; i < 16; i++) categories.push(deck.draw(null).category);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, categories.filter((x) => x === c.id).length]));
    for (const count of Object.values(counts)) assert.equal(count, 4);
    for (let i = 2; i < categories.length; i++) {
      assert.ok(!(categories[i] === categories[i - 1] && categories[i] === categories[i - 2]), 'mais de 2 seguidas');
    }
  });

  test('prefere perguntas que a sala ainda não viu', () => {
    const bank = makeBank([makeQuestion(), makeQuestion(), makeQuestion()]);
    const seen = new Set([bank.questions[0].id, bank.questions[1].id]);
    const deck = new QuestionDeck(bank.questions, { seen });
    assert.equal(deck.draw(1).id, bank.questions[2].id);
    // acabaram as inéditas: usa as já vistas em vez de falhar
    assert.ok(deck.draw(1));
    assert.ok(deck.draw(1));
    assert.equal(deck.draw(1), null);
  });

  test('banco vazio ou insuficiente não quebra', () => {
    assert.equal(new QuestionDeck([]).draw(1), null);
    const deck = new QuestionDeck(makeBank([makeQuestion()]).questions);
    assert.ok(deck.draw(4));
    assert.equal(deck.draw(4), null);
  });

  test('filtros de etiquetas: união, interseção e exclusão', () => {
    const bank = makeBank([
      makeQuestion({ category: 'esportes', tags: ['brasil', 'futebol'] }),
      makeQuestion({ category: 'esportes', tags: ['internacional', 'futebol'], difficulty: 3 }),
      makeQuestion({ category: 'memes', tags: ['brasil'] }),
      makeQuestion({ category: 'cinema_tv', tags: ['internacional'] }),
    ]);
    assert.equal(bank.filter([]).length, 4);
    assert.equal(bank.filter([{ tag: 'Futebol e Esportes', op: 'union' }]).length, 2);
    assert.equal(bank.filter([{ tag: 'futebol e esportes', op: 'union' }, { tag: 'memes e internet', op: 'union' }]).length, 3);
    assert.equal(bank.filter([{ tag: 'brasil', op: 'intersection' }]).length, 2);
    assert.equal(bank.filter([{ tag: 'difícil', op: 'exclusion' }]).length, 3);
    assert.equal(
      bank.filter([
        { tag: 'Futebol e Esportes', op: 'union' },
        { tag: 'brasil', op: 'exclusion' },
      ]).length,
      1,
    );
  });
});
