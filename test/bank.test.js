import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateQuestion } from '../src/core/questionBank.js';
import { loadQuestionBank } from '../server/bankLoader.js';
import { makeQuestion, makeBank, CATEGORIES } from './helpers.js';

describe('banco de perguntas', () => {
  test('pergunta válida não tem erros', () => {
    assert.deepEqual(validateQuestion(makeQuestion(), { categoryIds: new Set(['aleatorio']) }), []);
  });

  test('aponta campos obrigatórios e valores inválidos', () => {
    const errors = validateQuestion({ id: 'x', category: 'nada', type: 'video', difficulty: 7, prompt: '', answers: [] }, { categoryIds: new Set(['aleatorio']) });
    const text = errors.join(' | ');
    for (const piece of ['categoria desconhecida', 'tipo inválido', 'dificuldade inválida', 'enunciado', 'ao menos uma resposta', 'mídia']) {
      assert.ok(text.includes(piece), `faltou: ${piece}`);
    }
  });

  test('recusa pergunta que entrega a resposta no enunciado ou no texto alternativo', () => {
    const leak = makeQuestion({ prompt: 'Qual monumento é o Cristo Redentor?', answers: ['Cristo Redentor'] });
    assert.ok(validateQuestion(leak).some((e) => e.includes('revela a resposta')));
    const altLeak = makeQuestion({
      type: 'image',
      answers: ['Capivara'],
      media: { type: 'image', file: 'a.jpg', alt: 'Foto de uma capivara' },
    });
    assert.ok(validateQuestion(altLeak).some((e) => e.includes('revela a resposta')));
  });

  test('ids duplicados são recusados', () => {
    const a = makeQuestion();
    const bank = makeBank([a, { ...a }]);
    assert.equal(bank.size, 1);
    assert.equal(bank.rejected[0].errors[0], 'id duplicado');
  });

  test('imagem ausente: usa a pista em texto quando existe, senão tira a pergunta do sorteio', () => {
    const withFallback = makeQuestion({
      type: 'image',
      answers: ['Capivara'],
      media: { type: 'image', file: 'sumiu.jpg', alt: 'Foto de um animal', fallbackText: 'O maior roedor do mundo' },
    });
    const without = makeQuestion({ type: 'image', answers: ['Tamanduá'], media: { type: 'image', file: 'sumiu2.jpg', alt: 'Foto de um animal' } });
    const bank = makeBank([withFallback, without], { mediaExists: () => false });
    assert.equal(bank.size, 1);
    assert.equal(bank.get(withFallback.id).media.unavailable, true);
    assert.equal(bank.warnings.length, 1);
    assert.match(bank.rejected[0].errors[0], /não encontrada/);
  });

  test('carrega arquivos de uma pasta e não cai com JSON inválido', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nalata-'));
    try {
      mkdirSync(join(dir, 'questions'));
      mkdirSync(join(dir, 'media'));
      writeFileSync(join(dir, 'categories.json'), JSON.stringify(CATEGORIES));
      writeFileSync(join(dir, 'questions', 'a.json'), JSON.stringify([makeQuestion(), makeQuestion()]));
      writeFileSync(join(dir, 'questions', 'quebrado.json'), '{ isto não é json');
      writeFileSync(join(dir, 'media', 'ok.jpg'), 'x');
      writeFileSync(
        join(dir, 'questions', 'img.json'),
        JSON.stringify([
          makeQuestion({ type: 'image', answers: ['Zeta'], media: { type: 'image', file: 'ok.jpg', alt: 'Foto' } }),
          makeQuestion({ type: 'image', answers: ['Eta'], media: { type: 'image', file: '../fora.jpg', alt: 'Foto' } }),
        ]),
      );
      const { bank, fileErrors } = loadQuestionBank(dir);
      assert.equal(bank.size, 3);
      assert.equal(fileErrors.length, 1);
      assert.equal(fileErrors[0].file, 'quebrado.json');
      assert.equal(bank.rejected.length, 1); // caminho fora de data/media é recusado
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('etiquetas incluem categoria, dificuldade e tipo', () => {
    const bank = makeBank([makeQuestion({ category: 'memes', difficulty: 4, type: 'emoji', media: { type: 'emoji', text: '🐸☕' } })]);
    const tags = bank.tagIndex().map((t) => t.tag);
    for (const tag of ['Memes e Internet', 'especialista', 'emoji', 'brasil']) assert.ok(tags.includes(tag), tag);
  });

  test('o banco real do projeto carrega sem perguntas inválidas', () => {
    const { bank, fileErrors } = loadQuestionBank();
    assert.deepEqual(fileErrors, []);
    assert.deepEqual(bank.rejected, [], bank.rejected.map((r) => `${r.id}: ${r.errors.join('; ')}`).join('\n'));
  });
});
