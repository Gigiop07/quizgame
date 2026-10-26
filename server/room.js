// Uma sala: membros (jogadores e espectadores), líder, regras, chat e a partida atual.
// Recebe as mensagens dos clientes e repassa as ações de jogo para a Match.

import { randomUUID } from 'node:crypto';
import { systemClock } from '../src/core/clock.js';
import { LIMITS, TIMINGS } from '../src/core/config.js';
import { Match, MATCH_PHASE, END_REASON } from '../src/core/match.js';
import { defaultRules, sanitizeRules } from '../src/core/rules.js';
import { containsAnswer } from '../src/core/answers.js';
import { GUESS } from '../src/core/round.js';
import { buildState } from './views.js';

const RATE_LIMITS = {
  answer: { max: 8, windowMs: 2000 },
  chat: { max: 5, windowMs: 5000 },
  hint: { max: 4, windowMs: 2000 },
  rules: { max: 20, windowMs: 5000 },
};

export function cleanName(name) {
  const clean = String(name ?? '')
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.nameLength);
  return clean || 'Convidado';
}

export class Room {
  constructor({ code, bank, clock = systemClock, rng = Math.random, timings, media, log = () => {}, onEmpty = () => {} }) {
    this.code = code;
    this.bank = bank;
    this.clock = clock;
    this.rng = rng;
    this.timings = { ...TIMINGS, ...timings };
    this.media = media;
    this.log = log;
    this.onEmpty = onEmpty;
    this.members = new Map();
    this.leaderId = null;
    this.rules = defaultRules();
    this.match = null;
    this.lastResults = null;
    this.lastMatchEndedAt = null;
    this.mediaToken = null;
    this.seen = new Set();
    this.chat = [];
    this.chatSeq = 0;
    this.autoStartAt = null;
    this.autoStartTimer = null;
  }

  // ——— membros ———

  /** Entra (ou reconecta, se o token for de um membro existente). */
  join({ name, token, send }) {
    const existing = token ? [...this.members.values()].find((m) => m.token === token) : null;
    if (existing) {
      if (existing.disconnectTimer) this.clock.clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
      existing.send = send;
      existing.connected = true;
      this.match?.setConnected(existing.id, true);
      this.sendTo(existing.id, { t: 'chatHistory', messages: this.chat });
      this.changed();
      return existing;
    }
    const member = {
      id: randomUUID(),
      token: randomUUID(),
      name: this.uniqueName(cleanName(name)),
      send,
      connected: true,
      isPlayer: false,
      disconnectTimer: null,
      hits: new Map(),
    };
    this.members.set(member.id, member);
    if (!this.leaderId) this.leaderId = member.id;
    this.sendTo(member.id, { t: 'chatHistory', messages: this.chat });
    this.system(`${member.name} entrou na sala.`);
    this.changed();
    return member;
  }

  disconnect(memberId) {
    const member = this.members.get(memberId);
    if (!member || !member.connected) return;
    member.connected = false;
    member.send = null;
    this.match?.setConnected(memberId, false);
    member.disconnectTimer = this.clock.setTimeout(() => this.removeMember(memberId), this.timings.disconnectGraceMs);
    this.changed();
  }

  removeMember(memberId) {
    const member = this.members.get(memberId);
    if (!member) return;
    if (member.disconnectTimer) this.clock.clearTimeout(member.disconnectTimer);
    this.members.delete(memberId);
    if (member.isPlayer) this.match?.removePlayer(memberId);
    if (this.leaderId === memberId) {
      const next = [...this.members.values()].find((m) => m.connected) ?? [...this.members.values()][0];
      this.leaderId = next?.id ?? null;
      if (next) this.system(`${next.name} agora é quem lidera a sala.`);
    }
    this.system(`${member.name} saiu da sala.`);
    if (this.members.size === 0) {
      this.dispose();
      this.onEmpty(this);
      return;
    }
    this.changed();
  }

  playerMembers() {
    return [...this.members.values()].filter((m) => m.isPlayer);
  }

  connectedPlayers() {
    return this.playerMembers().filter((m) => m.connected);
  }

  uniqueName(name) {
    const taken = new Set([...this.members.values()].map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, LIMITS.nameLength - 3)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // ——— mensagens dos clientes ———

  handle(memberId, msg) {
    const member = this.members.get(memberId);
    if (!member || !msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'joinGame':
        return this.joinGame(member);
      case 'leaveGame':
        return this.leaveGame(member);
      case 'startNow':
        return this.startNow(member);
      case 'setRules':
        return this.setRules(member, msg.rules);
      case 'answer':
        return this.answer(member, msg.text);
      case 'hint':
        return this.hint(member);
      case 'chat':
        return this.chatMessage(member, msg.text);
      case 'mediaError':
        return this.mediaError(member);
      default:
        return undefined;
    }
  }

  joinGame(member) {
    if (member.isPlayer) return;
    member.isPlayer = true;
    this.match?.addPlayer(member.id, member.name);
    this.system(`${member.name} entrou no jogo.`);
    this.changed();
  }

  leaveGame(member) {
    if (!member.isPlayer) return;
    member.isPlayer = false;
    this.match?.removePlayer(member.id);
    this.system(`${member.name} saiu do jogo.`);
    this.changed();
  }

  startNow(member) {
    if (member.id !== this.leaderId || this.match) return;
    if (this.connectedPlayers().length === 0) {
      this.sendTo(member.id, { t: 'notice', text: 'Clique em "Entrar no jogo" antes de começar.' });
      return;
    }
    this.startMatch();
  }

  setRules(member, changes) {
    if (member.id !== this.leaderId) return;
    if (this.match) {
      this.sendTo(member.id, { t: 'notice', text: 'As regras só podem mudar entre partidas.' });
      return;
    }
    if (!this.allow(member, 'rules')) return;
    this.rules = sanitizeRules(changes, this.rules);
    this.cancelAutoStart();
    this.changed();
  }

  answer(member, text) {
    if (!this.match || !member.isPlayer || !this.allow(member, 'answer')) return;
    const outcome = this.match.submit(member.id, String(text ?? ''));
    if (outcome.result !== GUESS.EMPTY) this.sendTo(member.id, { t: 'guessResult', ...outcome });
  }

  hint(member) {
    if (!this.match || !member.isPlayer || !this.allow(member, 'hint')) return;
    const result = this.match.useHint(member.id);
    if (result.error) this.sendTo(member.id, { t: 'notice', text: hintError(result.error) });
  }

  chatMessage(member, rawText) {
    const text = String(rawText ?? '').replace(/[\p{Cc}]/gu, ' ').trim().slice(0, LIMITS.chatLength);
    if (!text || !this.allow(member, 'chat')) return;
    const round = this.match?.current;
    const spoiler = this.match?.phase === MATCH_PHASE.QUESTION && containsAnswer(round.question, text);
    this.pushChat({ authorId: member.id, author: member.name, text: spoiler ? null : text, hidden: spoiler });
  }

  mediaError(member) {
    const round = this.match?.current;
    if (!round) return;
    this.match.reportMediaError(member.id);
    this.log('media_error', { room: this.code, question: round.question.id, file: round.question.media.file });
  }

  // ——— partida ———

  poolSize() {
    return this.bank.filter(this.rules.filters).length;
  }

  startMatch() {
    this.cancelAutoStart();
    const questions = this.bank.filter(this.rules.filters);
    if (questions.length === 0) {
      this.system('Nenhuma pergunta combina com os filtros atuais. Ajuste as regras para começar.');
      this.changed();
      return;
    }
    const players = this.connectedPlayers();
    if (players.length === 0) return;
    // quando a sala já viu todas as perguntas desses filtros, recomeça o ciclo
    if (questions.every((q) => this.seen.has(q.id))) for (const q of questions) this.seen.delete(q.id);

    this.lastResults = null;
    this.match = new Match({
      bank: this.bank,
      questions,
      rules: { ...this.rules },
      players: players.map((m) => ({ id: m.id, name: m.name })),
      clock: this.clock,
      rng: this.rng,
      seen: this.seen,
      timings: this.timings,
      onChange: (event) => this.onMatchEvent(event),
    });
    this.match.start();
  }

  onMatchEvent(event) {
    const match = this.match;
    if (event.type === 'round_started') {
      const { question } = match.current;
      this.seen.add(question.id);
      this.mediaToken =
        question.media.type === 'image' && !question.media.unavailable ? this.media?.register(question.media.file) : null;
    }
    if (event.type === 'finished') {
      this.lastResults = match.results;
      this.lastMatchEndedAt = this.clock.now();
      this.match = null;
      this.mediaToken = null;
      this.announceResults(match.results, event.reason);
      this.updateAutoStart();
    }
    this.broadcast();
  }

  announceResults(results, reason) {
    if (reason === END_REASON.NO_PLAYERS || results.roundsPlayed === 0) {
      this.system('Partida encerrada.');
      return;
    }
    const winner = results.ranking[0];
    if (reason === END_REASON.OUT_OF_QUESTIONS) this.system('Acabaram as perguntas disponíveis com esses filtros.');
    if (winner) this.system(`🏆 ${winner.name} venceu com ${winner.score} ${winner.score === 1 ? 'ponto' : 'pontos'}!`);
  }

  /** Começa sozinho quando há jogadores suficientes conectados. */
  updateAutoStart() {
    if (this.match) {
      this.cancelAutoStart();
      return;
    }
    const enough = this.connectedPlayers().length >= this.rules.minPlayers && this.poolSize() > 0;
    if (!enough) {
      this.cancelAutoStart();
      return;
    }
    if (this.autoStartTimer) return;
    const now = this.clock.now();
    const afterMatch = this.lastMatchEndedAt === null ? 0 : this.lastMatchEndedAt + this.timings.afterMatchMs - now;
    const delay = Math.max(this.timings.autoStartMs, afterMatch);
    this.autoStartAt = now + delay;
    this.autoStartTimer = this.clock.setTimeout(() => {
      this.autoStartTimer = null;
      this.autoStartAt = null;
      this.startMatch();
      this.broadcast();
    }, delay);
  }

  cancelAutoStart() {
    if (this.autoStartTimer) this.clock.clearTimeout(this.autoStartTimer);
    this.autoStartTimer = null;
    this.autoStartAt = null;
  }

  // ——— comunicação ———

  /** Algo mudou: reavalia o início automático e envia o estado para todos. */
  changed() {
    this.updateAutoStart();
    this.broadcast();
  }

  broadcast() {
    for (const member of this.members.values()) {
      if (member.connected) this.sendTo(member.id, buildState(this, member.id));
    }
  }

  sendTo(memberId, payload) {
    const member = this.members.get(memberId);
    if (member?.connected && member.send) member.send(payload);
  }

  system(text) {
    this.pushChat({ system: true, text });
  }

  pushChat(entry) {
    const message = { id: ++this.chatSeq, at: this.clock.now(), ...entry };
    this.chat.push(message);
    if (this.chat.length > LIMITS.chatHistory) this.chat.shift();
    for (const member of this.members.values()) this.sendTo(member.id, { t: 'chat', message });
  }

  allow(member, action) {
    const { max, windowMs } = RATE_LIMITS[action];
    const now = this.clock.now();
    const recent = (member.hits.get(action) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return false;
    recent.push(now);
    member.hits.set(action, recent);
    return true;
  }

  dispose() {
    this.cancelAutoStart();
    this.match?.stop();
    for (const member of this.members.values()) {
      if (member.disconnectTimer) this.clock.clearTimeout(member.disconnectTimer);
    }
  }
}

function hintError(code) {
  return (
    {
      disabled: 'As pistas estão desativadas nesta sala.',
      no_more_hints: 'Não há mais pistas para esta pergunta.',
      closed: 'A rodada já terminou.',
    }[code] ?? 'Pista indisponível agora.'
  );
}
