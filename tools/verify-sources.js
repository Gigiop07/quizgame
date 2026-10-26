// Verifica se as fontes da Wikipédia citadas nas perguntas existem de verdade,
// consultando a API da Wikipédia em lotes (sem baixar as páginas).
// Uso: npm run verify:sources

import { loadQuestionBank } from '../server/bankLoader.js';

const USER_AGENT = 'QuizCulturalBR/0.1 (jogo local; verificador de fontes)';
const BATCH = 50;

const { bank } = loadQuestionBank(process.env.DATA_DIR || undefined);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET com nova tentativa quando a Wikipédia pede para ir mais devagar (HTTP 429/503). */
async function fetchJson(url, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) return response.json();
    if (attempt >= attempts || ![429, 503].includes(response.status)) {
      throw new Error(`${url.hostname} respondeu ${response.status}`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
  }
}

// agrupa os títulos por wiki (pt.wikipedia.org, en.wikipedia.org...)
const byHost = new Map();
const others = [];
for (const q of bank.questions) {
  const url = q.source?.url;
  if (!url) continue;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    others.push({ id: q.id, url, problem: 'URL inválida' });
    continue;
  }
  if (!/\.wikipedia\.org$/.test(parsed.hostname) || !parsed.pathname.startsWith('/wiki/')) {
    if (parsed.hostname !== 'commons.wikimedia.org') others.push({ id: q.id, url, problem: 'fonte fora da Wikipédia (confira manualmente)' });
    continue;
  }
  const title = decodeURIComponent(parsed.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
  const list = byHost.get(parsed.hostname) ?? [];
  list.push({ id: q.id, url, title });
  byHost.set(parsed.hostname, list);
}

const missing = [];
let checked = 0;
for (const [host, entries] of byHost) {
  const titles = [...new Set(entries.map((e) => e.title))];
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const api = new URL(`https://${host}/w/api.php`);
    api.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: batch.join('|') });
    const data = await fetchJson(api);
    // normalizações e redirecionamentos levam o título pedido ao título final
    const rename = new Map();
    for (const n of data.query.normalized ?? []) rename.set(n.from, n.to);
    for (const r of data.query.redirects ?? []) rename.set(r.from, r.to);
    const finalTitle = (t) => {
      let current = t;
      for (let guard = 0; rename.has(current) && guard < 5; guard++) current = rename.get(current);
      return current;
    };
    const missingTitles = new Set(data.query.pages.filter((p) => p.missing || p.invalid).map((p) => p.title));
    for (const title of batch) {
      checked++;
      if (missingTitles.has(finalTitle(title))) {
        for (const e of entries.filter((x) => x.title === title)) missing.push(e);
      }
    }
  }
}

console.log(`${checked} páginas verificadas.`);
for (const m of missing) console.error(`✗ ${m.id}: página não existe — ${m.url}`);
for (const o of others) console.warn(`⚠ ${o.id}: ${o.problem} — ${o.url}`);
console.log(missing.length ? `\n${missing.length} fonte(s) inexistente(s).` : '\nTodas as fontes da Wikipédia existem.');
process.exitCode = missing.length ? 1 : 0;
