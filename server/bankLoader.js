// Carrega o banco de perguntas dos arquivos JSON em data/.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuestionBank } from '../src/core/questionBank.js';

export const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

/**
 * Lê data/categories.json e todos os data/questions/*.json.
 * Arquivos com JSON inválido são relatados em `fileErrors` e não derrubam o servidor.
 */
export function loadQuestionBank(dataDir = DATA_DIR) {
  const categories = JSON.parse(readFileSync(join(dataDir, 'categories.json'), 'utf8'));
  const questionsDir = join(dataDir, 'questions');
  const mediaDir = join(dataDir, 'media');
  const questions = [];
  const fileErrors = [];
  const files = existsSync(questionsDir) ? readdirSync(questionsDir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(questionsDir, file), 'utf8'));
      if (!Array.isArray(content)) throw new Error('o arquivo deve conter uma lista de perguntas');
      questions.push(...content);
    } catch (error) {
      fileErrors.push({ file, error: error.message });
    }
  }
  const bank = new QuestionBank(questions, {
    categories,
    mediaExists: (file) => isSafeMediaName(file) && existsSync(join(mediaDir, file)),
  });
  return { bank, files, fileErrors, mediaDir };
}

/** Nome de arquivo simples, sem caminhos (evita ler fora de data/media). */
export function isSafeMediaName(file) {
  return typeof file === 'string' && /^[\w.-]+$/.test(file) && !file.startsWith('.');
}
