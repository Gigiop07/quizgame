import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, answerKey, compactKey } from '../src/core/normalize.js';
import { checkAnswer, containsAnswer, editDistance, allowedTypos, MATCH } from '../src/core/answers.js';
import { makeQuestion } from './helpers.js';

describe('normalização', () => {
  test('remove espaços extras, maiúsculas, acentos e pontuação', () => {
    assert.equal(normalizeText('  Pelé!! '), 'pele');
    assert.equal(normalizeText('Homem-Aranha'), 'homem aranha');
    assert.equal(normalizeText('São   Paulo   F.C.'), 'sao paulo f c');
    assert.equal(normalizeText('Tom & Jerry'), 'tom e jerry');
    assert.equal(normalizeText("Pingo d'Água"), 'pingo dagua');
  });

  test('ignora artigo no começo, mas não quando a resposta é só o artigo', () => {
    assert.equal(answerKey('O Rei Leão'), 'rei leao');
    assert.equal(answerKey('The Office'), 'office');
    assert.equal(answerKey('A'), 'a');
  });

  test('chave compacta ignora espaços', () => {
    assert.equal(compactKey('Spider-Man'), compactKey('spiderman'));
  });
});

describe('validação de respostas', () => {
  const pele = makeQuestion({ answers: ['Pelé', 'Edson Arantes do Nascimento'], acceptedAliases: ['Rei do Futebol'] });
  const aranha = makeQuestion({ answers: ['Homem-Aranha', 'Spider-Man'], acceptedAliases: ['Aranha'] });

  test('aceita a resposta certa', () => {
    assert.deepEqual(checkAnswer(pele, 'Pelé'), { correct: true, match: MATCH.EXACT });
    assert.equal(checkAnswer(pele, 'Edson Arantes do Nascimento').correct, true);
  });

  test('aceita com e sem acentos, maiúsculas e pontuação', () => {
    for (const guess of ['pele', 'PELE', 'pelé', ' Pelé. ', 'pe-le']) {
      assert.equal(checkAnswer(pele, guess).correct, true, guess);
    }
  });

  test('aceita variações cadastradas', () => {
    for (const guess of ['homem aranha', 'homem-aranha', 'spiderman', 'Spider Man', 'spider-man']) {
      assert.equal(checkAnswer(aranha, guess).correct, true, guess);
    }
  });

  test('atalhos só valem quando a sala permite', () => {
    assert.equal(checkAnswer(pele, 'rei do futebol', { shortcuts: true }).match, MATCH.ALIAS);
    assert.equal(checkAnswer(pele, 'rei do futebol', { shortcuts: false }).correct, false);
  });

  test('rejeita resposta errada', () => {
    assert.equal(checkAnswer(pele, 'Garrincha').correct, false);
    assert.equal(checkAnswer(aranha, 'Batman').correct, false);
  });

  test('resposta vazia não conta como tentativa', () => {
    assert.equal(checkAnswer(pele, '').match, MATCH.EMPTY);
    assert.equal(checkAnswer(pele, '   ').match, MATCH.EMPTY);
    assert.equal(checkAnswer(pele, '!!!').match, MATCH.EMPTY);
    assert.equal(checkAnswer(pele, undefined).match, MATCH.EMPTY);
  });

  test('tolera erro pequeno de digitação só em nomes longos', () => {
    const q = makeQuestion({ answers: ['Ronaldinho'] });
    assert.equal(checkAnswer(q, 'Ronaldinio').match, MATCH.TYPO);
    assert.equal(checkAnswer(q, 'Ronaldnho').match, MATCH.TYPO);
    assert.equal(checkAnswer(q, 'Ronaldinio', { typoTolerance: false }).correct, false);
    // nome curto: nada de aproximação
    const mario = makeQuestion({ answers: ['Mario'] });
    assert.equal(checkAnswer(mario, 'Wario').correct, false);
  });

  test('não aceita respostas que só compartilham letras', () => {
    const q = makeQuestion({ answers: ['Ronaldinho'] });
    assert.equal(checkAnswer(q, 'Ronaldo').correct, false);
    assert.equal(checkAnswer(q, 'Rivaldo').correct, false);
    const longo = makeQuestion({ answers: ['Cristiano Ronaldo'] });
    assert.equal(checkAnswer(longo, 'Cristiano').correct, false);
  });

  test('números diferentes nunca passam como erro de digitação', () => {
    const q = makeQuestion({ answers: ['Toy Story 3'] });
    assert.equal(checkAnswer(q, 'Toy Story 2').correct, false);
    assert.equal(checkAnswer(q, 'Toy Stori 3').correct, true);
  });

  test('respostas proibidas e respostas de outras perguntas não passam por aproximação', () => {
    const gambia = makeQuestion({ answers: ['Gâmbia'], rejectedAnswers: [] });
    const known = new Set(['zambia']);
    assert.equal(checkAnswer(gambia, 'Zambia', { knownAnswers: known }).correct, false);
    const link = makeQuestion({ answers: ['Link'], rejectedAnswers: ['Zelda'] });
    assert.equal(checkAnswer(link, 'Zelda').correct, false);
  });

  test('pergunta pode desligar a aproximação', () => {
    const q = makeQuestion({ answers: ['Eslováquia'], fuzzy: false });
    assert.equal(checkAnswer(q, 'Eslovaquia').correct, true);
    assert.equal(checkAnswer(q, 'Eslovaqia').correct, false);
  });

  test('indica quando a resposta está quase certa, sem aceitá-la', () => {
    const q = makeQuestion({ answers: ['Maradona'] });
    const result = checkAnswer(q, 'Marodana');
    assert.equal(result.correct, false);
    assert.equal(result.match, MATCH.NEAR);
  });

  test('distância de edição e limites', () => {
    assert.equal(editDistance('abc', 'abc'), 0);
    assert.equal(editDistance('abcd', 'abdc'), 1); // transposição
    assert.equal(editDistance('kitten', 'sitting'), 3);
    assert.equal(allowedTypos(5), 0);
    assert.equal(allowedTypos(6), 1);
    assert.equal(allowedTypos(11), 2);
  });

  test('detecta spoiler no chat', () => {
    assert.equal(containsAnswer(pele, 'acho que é o pelé kkk'), true);
    assert.equal(containsAnswer(pele, 'apelei feio nessa'), false);
    assert.equal(containsAnswer(aranha, 'é o spiderman!'), true);
  });
});
