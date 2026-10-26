// Confere o banco de perguntas: erros de formato, imagens faltando e um resumo do conteúdo.
// Uso: npm run validate:questions

import { loadQuestionBank } from '../server/bankLoader.js';
import { DIFFICULTY_LABELS, TYPE_LABELS } from '../src/core/config.js';

const { bank, files, fileErrors } = loadQuestionBank(process.env.DATA_DIR || undefined);

for (const { file, error } of fileErrors) console.error(`✗ ${file}: ${error}`);
for (const { id, errors } of bank.rejected) console.error(`✗ ${id}: ${errors.join('; ')}`);
for (const warning of bank.warnings) console.warn(`⚠ ${warning}`);

const count = (key) => {
  const map = new Map();
  for (const q of bank.questions) map.set(key(q), (map.get(key(q)) ?? 0) + 1);
  return map;
};

console.log(`\n${bank.size} perguntas válidas em ${files.length} arquivos.`);

console.log('\nPor categoria × dificuldade:');
const header = ['categoria'.padEnd(26), ...Object.values(DIFFICULTY_LABELS).map((l) => l.padStart(13)), 'total'.padStart(7)];
console.log(header.join(''));
for (const category of bank.categories) {
  const qs = bank.questions.filter((q) => q.category === category.id);
  const cells = Object.keys(DIFFICULTY_LABELS).map((d) => String(qs.filter((q) => q.difficulty === Number(d)).length).padStart(13));
  console.log([category.label.padEnd(26), ...cells, String(qs.length).padStart(7)].join(''));
}

console.log('\nPor tipo:');
for (const [type, n] of count((q) => q.type)) console.log(`  ${TYPE_LABELS[type] ?? type}: ${n}`);

const missingSource = bank.questions.filter((q) => !q.source?.url);
if (missingSource.length) console.warn(`\n⚠ ${missingSource.length} perguntas sem fonte: ${missingSource.map((q) => q.id).join(', ')}`);
const missingHints = bank.questions.filter((q) => q.hints.length === 0);
if (missingHints.length) console.log(`\nℹ ${missingHints.length} perguntas sem pistas.`);

// respostas iguais em perguntas diferentes costumam indicar duplicatas
const byAnswer = new Map();
for (const q of bank.questions) {
  const key = `${q.category}|${q.answers[0].toLowerCase()}`;
  byAnswer.set(key, [...(byAnswer.get(key) ?? []), q.id]);
}
const dupes = [...byAnswer].filter(([, ids]) => ids.length > 1);
if (dupes.length) {
  console.log('\nℹ Mesma resposta em mais de uma pergunta (confira se não são repetidas):');
  for (const [key, ids] of dupes) console.log(`  ${key.split('|')[1]}: ${ids.join(', ')}`);
}

const failed = fileErrors.length + bank.rejected.length;
console.log(failed ? `\n${failed} problema(s) encontrado(s).` : '\nNenhum problema encontrado.');
process.exitCode = failed ? 1 : 0;
