// Servidor do jogo: arquivos estáticos, imagens das perguntas e WebSocket das salas.
// Uso: npm start   (porta 3000 ou a variável PORT)

import { createServer } from 'node:http';
import { createReadStream, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { systemClock } from '../src/core/clock.js';
import { loadQuestionBank, isSafeMediaName } from './bankLoader.js';
import { MediaRegistry } from './mediaRegistry.js';
import { RoomManager } from './roomManager.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
// A interface reaproveita os módulos puros do núcleo (rótulos, limites das regras).
// Eles não contêm perguntas nem respostas, que ficam em data/.
const CORE_DIR = join(ROOT, 'src', 'core');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

/**
 * @param {object} options
 * @param {import('../src/core/questionBank.js').QuestionBank} options.bank
 * @param {string} options.mediaDir
 * @param {string} [options.publicDir]
 * @param {object} [options.clock]
 * @param {object} [options.timings] sobrescreve TIMINGS (útil nos testes)
 * @param {(event: string, data: object) => void} [options.log]
 */
export function createGameServer({ bank, mediaDir, publicDir = PUBLIC_DIR, clock = systemClock, timings, log = () => {} }) {
  const media = new MediaRegistry({ now: () => clock.now() });
  const manager = new RoomManager({ bank, clock, timings, media, log });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, rooms: manager.rooms.size, questions: bank.size });
    }
    if (url.pathname.startsWith('/m/')) {
      const file = media.resolve(url.pathname.slice(3));
      if (!file || !isSafeMediaName(file)) return sendText(res, 404, 'Imagem não encontrada');
      return sendFile(res, join(mediaDir, file), { cache: 'no-store' });
    }
    if (url.pathname.startsWith('/core/') && url.pathname.endsWith('.js')) {
      return serveStatic(res, CORE_DIR, url.pathname.slice('/core'.length));
    }
    return serveStatic(res, publicDir, url.pathname);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
  wss.on('connection', (socket) => {
    let room = null;
    let memberId = null;
    const send = (payload) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.t === 'ping') return send({ t: 'pong', clientTime: msg.clientTime, serverTime: clock.now() });
      if (msg?.t === 'hello') {
        if (room) return;
        if (msg.create) room = manager.create();
        else room = manager.get(msg.room);
        if (!room) {
          send({ t: 'error', code: 'room_not_found', text: 'Sala não encontrada. Confira o código ou crie uma nova.' });
          return socket.close(4004, 'room_not_found');
        }
        const member = room.join({ name: msg.name, token: msg.token, send });
        memberId = member.id;
        send({ t: 'welcome', room: room.code, memberId, token: member.token, tags: bank.tagIndex() });
        return room.broadcast();
      }
      if (room && memberId) room.handle(memberId, msg);
    });

    socket.on('close', () => {
      if (room && memberId) room.disconnect(memberId);
    });
  });

  return {
    server,
    manager,
    listen(port = 3000, host = '0.0.0.0') {
      return new Promise((resolveListen) => server.listen(port, host, () => resolveListen(server.address())));
    },
    close() {
      manager.closeAll();
      for (const client of wss.clients) client.terminate();
      wss.close();
      return new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

function serveStatic(res, publicDir, pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Endereço inválido');
  }
  if (path.endsWith('/')) path += 'index.html';
  const filePath = normalize(join(publicDir, path));
  if (!filePath.startsWith(publicDir + sep)) return sendText(res, 403, 'Acesso negado');
  return sendFile(res, filePath, { cache: 'no-cache' });
}

function sendFile(res, filePath, { cache }) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return sendText(res, 404, 'Não encontrado');
  }
  if (!stats.isFile()) return sendText(res, 404, 'Não encontrado');
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function createFileLogger(logDir) {
  return (event, data) => {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...data });
    console.warn(`[${event}]`, data);
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(join(logDir, 'media-errors.log'), line + '\n');
    } catch {
      // o registro em arquivo é opcional
    }
  };
}

// ——— execução direta ———

const isMain =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const { bank, files, fileErrors, mediaDir } = loadQuestionBank(process.env.DATA_DIR || undefined);
  for (const { file, error } of fileErrors) console.error(`✗ ${file}: ${error}`);
  for (const { id, errors } of bank.rejected) console.warn(`⚠ pergunta ${id} ignorada: ${errors.join('; ')}`);
  for (const warning of bank.warnings) console.warn(`⚠ ${warning}`);
  console.log(`Banco de perguntas: ${bank.size} perguntas válidas em ${files.length} arquivos.`);

  const port = Number(process.env.PORT) || 3000;
  const game = createGameServer({ bank, mediaDir, log: createFileLogger(join(ROOT, 'logs')) });
  await game.listen(port, process.env.HOST || '0.0.0.0');
  console.log(`\nNa Lata! rodando em http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`Na mesma rede: http://${ip}:${port}`);
}
