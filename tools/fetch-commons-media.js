#!/usr/bin/env node
// Baixa miniaturas do Wikimedia Commons para as perguntas de imagem
// e grava o crédito (autor, licença, página do arquivo) em cada pergunta.
//
// Uso: node tools/fetch-commons-media.js [--force]

import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS_FILE = path.join(ROOT, 'data', 'questions', 'imagens.json');
const MEDIA_DIR = path.join(ROOT, 'data', 'media');

const API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'QuizCulturalBR/0.1 (jogo local; script de midia)';
const BATCH_SIZE = 50;
const THUMB_WIDTH = 640; // o Commons arredonda para um tamanho padrão (hoje, 640 vira 960)
const MAX_AUTHOR_LENGTH = 120;
const MAX_ATTEMPTS = 6;
const MAX_WAIT_S = 300; // espera máxima por tentativa quando o Commons pede para aguardar
const PAUSE_MS = 1000; // pausa entre requisições, para não sobrecarregar o Commons
const FORCE = process.argv.includes('--force');

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ALL_EXTS = Object.values(EXT_BY_MIME);

// ---------- utilidades ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function stripHtml(html = '') {
  return html
    .replace(/<(\w+)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, ' ') // texto oculto (ex.: "Unknown author" duplicado)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove sobras de wikitexto do campo de autor: URLs soltas (quando há um nome), colchetes
// e links de discussão; "veja o histórico" vira uma indicação de vários autores
function tidyAuthor(text) {
  if (/see file history/i.test(text)) return 'Vários autores (ver página do arquivo)';
  const withoutUrls = text.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const cleaned = (withoutUrls || text)
    .replace(/^\[+|\]+$/g, '')
    .replace(/\((?:talk|discuter|discussão|disc\.)\)/gi, '')
    .replace(/\s+([;,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || text;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------- HTTP ----------

// fetch com User-Agent e novas tentativas em 429/5xx (respeitando Retry-After)
async function politeFetch(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < MAX_ATTEMPTS) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const seconds = Math.min(retryAfter > 0 ? retryAfter + 1 : 3 * attempt, MAX_WAIT_S);
    console.log(`  (HTTP ${res.status}: aguardando ${seconds}s antes de tentar de novo)`);
    await sleep(seconds * 1000);
    return politeFetch(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res;
}

// ---------- Commons API ----------

function apiUrl(titles) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: String(THUMB_WIDTH),
    titles: titles.join('|'),
  });
  return `${API_URL}?${params}`;
}

// Devolve um Map: título pedido -> página da API (já seguindo normalização e redirecionamentos)
async function fetchFileInfo(titles) {
  const result = new Map();
  for (const batch of chunk([...new Set(titles)], BATCH_SIZE)) {
    const data = await (await politeFetch(apiUrl(batch))).json();
    const query = data.query ?? {};
    const rename = new Map();
    for (const { from, to } of [...(query.normalized ?? []), ...(query.redirects ?? [])]) {
      rename.set(from, to);
    }
    const pages = new Map((query.pages ?? []).map((page) => [page.title, page]));
    for (const title of batch) {
      let current = title;
      while (rename.has(current)) current = rename.get(current);
      result.set(title, pages.get(current));
    }
    await sleep(PAUSE_MS);
  }
  return result;
}

// ---------- licença e crédito ----------

const metaValue = (meta, key) => stripHtml(meta?.[key]?.value ?? '');

const REJECTED_LICENSE = /\b(nc|nd)\b|non-?commercial|no-?deriv|fair use|non-?free/i;
const ACCEPTED_LICENSE = /public domain|domínio público|^pd\b|\bpd-|\bcc0\b|\bcc[- ]by(?:[- ]sa)?\b/i;

function isAcceptedLicense(meta) {
  const candidates = [
    metaValue(meta, 'LicenseShortName'),
    metaValue(meta, 'License'),
    metaValue(meta, 'UsageTerms'),
  ].filter(Boolean);
  if (candidates.length === 0) return false;
  if (candidates.some((text) => REJECTED_LICENSE.test(text))) return false;
  return candidates.some((text) => ACCEPTED_LICENSE.test(text));
}

function buildCredit(info) {
  const meta = info.extmetadata ?? {};
  const author = truncate(tidyAuthor(metaValue(meta, 'Artist')) || 'Autor desconhecido', MAX_AUTHOR_LENGTH);
  const credit = {
    author,
    license: metaValue(meta, 'LicenseShortName') || metaValue(meta, 'License'),
  };
  const licenseUrl = metaValue(meta, 'LicenseUrl');
  if (licenseUrl) credit.licenseUrl = licenseUrl.startsWith('//') ? `https:${licenseUrl}` : licenseUrl;
  credit.sourceUrl = info.descriptionurl;
  return credit;
}

// ---------- arquivos de mídia ----------

async function findExistingMedia(id) {
  for (const ext of ALL_EXTS) {
    const name = `${id}.${ext}`;
    if (await exists(path.join(MEDIA_DIR, name))) return name;
  }
  return null;
}

async function removeOtherMedia(id, keepName) {
  for (const ext of ALL_EXTS) {
    const name = `${id}.${ext}`;
    if (name !== keepName && (await exists(path.join(MEDIA_DIR, name)))) {
      await unlink(path.join(MEDIA_DIR, name));
    }
  }
}

async function downloadThumb(id, url) {
  const res = await politeFetch(url);
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`tipo de conteúdo não suportado: ${mime || 'desconhecido'}`);
  const name = `${id}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, name), Buffer.from(await res.arrayBuffer()));
  await removeOtherMedia(id, name);
  return name;
}

// ---------- processamento de cada pergunta ----------

async function processQuestion(question, page) {
  const { media } = question;
  if (!page || page.missing || page.invalid || !page.imageinfo?.length) {
    throw new Error(`arquivo não encontrado no Commons: ${media.commons}`);
  }
  const info = page.imageinfo[0];
  if (!isAcceptedLicense(info.extmetadata)) {
    const license = metaValue(info.extmetadata, 'LicenseShortName') || 'sem licença';
    throw new Error(`licença não aceita (${license}): ${media.commons}`);
  }

  const credit = buildCredit(info);
  const existing = await findExistingMedia(question.id);
  // só reaproveita o arquivo local se ele veio do mesmo arquivo do Commons
  const sameSource = media.credit?.sourceUrl === credit.sourceUrl;
  const reuse = existing && sameSource && !FORCE;

  if (!reuse) await sleep(PAUSE_MS);
  const file = reuse ? existing : await downloadThumb(question.id, info.thumburl ?? info.url);

  media.file = file;
  media.credit = credit;
  if (!question.source) {
    question.source = {
      url: credit.sourceUrl,
      attribution: `${credit.author} — ${credit.license}, via Wikimedia Commons`,
    };
  }
  return reuse ? 'skipped' : 'ok';
}

// ---------- principal ----------

function questionList(data) {
  return Array.isArray(data) ? data : data.questions ?? [];
}

async function main() {
  const data = JSON.parse(await readFile(QUESTIONS_FILE, 'utf8'));
  const questions = questionList(data).filter(
    (q) => q.media?.type === 'image' && typeof q.media.commons === 'string',
  );
  await mkdir(MEDIA_DIR, { recursive: true });

  const pages = await fetchFileInfo(questions.map((q) => q.media.commons));
  const summary = { ok: 0, skipped: 0, failed: 0 };
  const failures = [];

  for (const question of questions) {
    try {
      const status = await processQuestion(question, pages.get(question.media.commons));
      summary[status] += 1;
      console.log(`${status === 'ok' ? 'baixado ' : 'mantido '} ${question.id} -> ${question.media.file}`);
    } catch (error) {
      summary.failed += 1;
      failures.push(`${question.id}: ${error.message}`);
      console.error(`FALHOU   ${question.id}: ${error.message}`);
    }
  }

  await writeFile(QUESTIONS_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  console.log(`\nResumo: ${summary.ok} ok, ${summary.skipped} ignoradas (já baixadas), ${summary.failed} com falha`);
  if (failures.length) {
    console.log('Falhas:');
    for (const line of failures) console.log(`  - ${line}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
