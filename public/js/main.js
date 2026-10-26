// Interface do jogo. Toda regra de jogo (tempo, validação, pontos) fica no servidor;
// aqui só mostramos o estado recebido e enviamos as ações do jogador.

import { $, plural } from './dom.js';
import { Connection } from './net.js';
import { logo } from './ui/art.js';
import { Stage } from './ui/stage.js';
import { renderPlayers } from './ui/players.js';
import { Chat } from './ui/chat.js';
import { RulesPanel } from './ui/rulesPanel.js';
import { renderRoomPanel, renderAboutPanel } from './ui/panels.js';

const STORAGE = {
  name: 'nalata:nome',
  token: (code) => `nalata:token:${code}`,
};

const storage = {
  get(area, key) {
    try {
      return area.getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      area.setItem(key, value);
    } catch {
      // armazenamento indisponível (aba anônima etc.): segue sem lembrar
    }
  },
  remove(area, key) {
    try {
      area.removeItem(key);
    } catch {
      // idem
    }
  },
};

const app = {
  state: null,
  roomCode: null,
  lastRound: null,
  roomPanelCode: null,
};

const el = {
  landing: $('#landing'),
  landingForm: $('#landing-form'),
  nickname: $('#nickname'),
  roomCode: $('#room-code'),
  landingError: $('#landing-error'),
  room: $('#room'),
  status: $('#status'),
  timerFill: $('#timer-fill'),
  rulesSummary: $('#rules-summary'),
  editRules: $('#edit-rules'),
  lobbyBar: $('#lobby-bar'),
  joinBtn: $('#join-btn'),
  leaveBtn: $('#leave-btn'),
  leaveBtn2: $('#leave-btn-2'),
  answerForm: $('#answer-form'),
  answerInput: $('#answer-input'),
  hintBtn: $('#hint-btn'),
  players: $('#players'),
  toast: $('#toast'),
};

const connection = new Connection({ onMessage: handleMessage, onStatus: handleConnectionStatus });
const send = (msg) => connection.send(msg);

const stage = new Stage({
  el: $('#stage'),
  onMediaError: () => send({ t: 'mediaError' }),
  onStart: () => send({ t: 'startNow' }),
});
const chat = new Chat({ log: $('#chat-log'), form: $('#chat-form'), input: $('#chat-input'), send: (text) => send({ t: 'chat', text }) });
const rulesPanel = new RulesPanel({ el: $('#rules-panel'), send: (rules) => send({ t: 'setRules', rules }) });
renderAboutPanel($('#about-panel'));

// ——— tela inicial ———

document.querySelectorAll('[data-logo]').forEach((slot) => slot.append(logo()));
el.nickname.value = storage.get(localStorage, STORAGE.name) ?? '';
const codeFromUrl = location.hash.replace('#', '').toUpperCase().slice(0, 4);
if (codeFromUrl) el.roomCode.value = codeFromUrl;
(el.nickname.value ? el.roomCode : el.nickname).focus();

el.landingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitLanding(event.submitter?.dataset.action ?? defaultLandingAction());
});

// Enter num campo: entra na sala se há código (ex.: veio por convite), senão cria uma
for (const input of [el.nickname, el.roomCode]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitLanding(defaultLandingAction());
  });
}

function defaultLandingAction() {
  return el.roomCode.value.trim() ? 'join' : 'create';
}

function submitLanding(action) {
  const name = el.nickname.value.trim();
  if (!name) {
    el.landingError.textContent = 'Escolha um apelido.';
    el.nickname.focus();
    return;
  }
  storage.set(localStorage, STORAGE.name, name);
  if (action === 'join') {
    const code = el.roomCode.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      el.landingError.textContent = 'O código da sala tem 4 letras.';
      el.roomCode.focus();
      return;
    }
    enterRoom({ room: code, name });
  } else {
    enterRoom({ create: true, name });
  }
}

function enterRoom({ room, create, name }) {
  el.landingError.textContent = '';
  const token = room ? storage.get(sessionStorage, STORAGE.token(room)) : null;
  connection.connect({ t: 'hello', room, create: Boolean(create), name, token });
}

// volta direto para a sala ao recarregar a página
if (codeFromUrl && el.nickname.value && storage.get(sessionStorage, STORAGE.token(codeFromUrl))) {
  enterRoom({ room: codeFromUrl, name: el.nickname.value });
}

// ——— mensagens do servidor ———

function handleMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      app.roomCode = msg.room;
      storage.set(sessionStorage, STORAGE.token(msg.room), msg.token);
      connection.updateHello({ room: msg.room, create: false, token: msg.token });
      history.replaceState(null, '', `#${msg.room}`);
      rulesPanel.setTags(msg.tags ?? []);
      el.landing.hidden = true;
      el.room.hidden = false;
      break;
    case 'state':
      app.state = msg;
      render();
      break;
    case 'chatHistory':
      chat.reset(msg.messages);
      break;
    case 'chat':
      chat.add(msg.message);
      break;
    case 'guessResult':
      guessFeedback(msg);
      break;
    case 'notice':
      toast(msg.text);
      break;
    case 'error':
      if (msg.code === 'room_not_found') {
        el.room.hidden = true;
        el.landing.hidden = false;
        el.landingError.textContent = msg.text;
        history.replaceState(null, '', location.pathname);
      } else {
        toast(msg.text, 'bad');
      }
      break;
    default:
      break;
  }
}

function handleConnectionStatus(status) {
  if (status === 'reconnecting' && app.state) toast('Conexão perdida. Tentando reconectar…', 'bad');
  if (status === 'open' && app.state) toast('Conectado de novo!', 'good');
}

// ——— renderização ———

function render() {
  const state = app.state;
  el.rulesSummary.textContent = state.room.summary;
  el.editRules.textContent = state.self?.isLeader && !state.match ? 'Editar regras' : 'Ver regras';
  renderPlayers(el.players, state);
  rulesPanel.update(state);
  stage.render(state);
  renderBottomBar(state);
  if (app.roomPanelCode !== state.room.code) {
    app.roomPanelCode = state.room.code;
    renderRoomPanel($('#room-panel'), state, toast);
  }
}

function renderBottomBar(state) {
  const match = state.match;
  const me = state.players.find((p) => p.id === state.self?.id);
  const playing = Boolean(match && state.self?.isPlayer && !me?.eliminated);
  el.answerForm.hidden = !playing;
  el.lobbyBar.hidden = playing;
  el.joinBtn.hidden = Boolean(state.self?.isPlayer);
  el.leaveBtn.hidden = !state.self?.isPlayer;
  if (!playing) return;

  const round = match.me;
  const question = match.question;
  const roundKey = `${match.roundNumber}:${match.phase}`;
  const canAnswer = Boolean(round?.canAnswer);
  el.answerInput.disabled = !canAnswer;
  el.answerForm.classList.toggle('correct', round?.status === 'correct');
  el.answerInput.placeholder = answerPlaceholder(match, round);

  if (roundKey !== app.lastRound) {
    app.lastRound = roundKey;
    if (match.phase === 'question') {
      el.answerInput.value = '';
      el.answerForm.classList.remove('wrong', 'correct');
      // não rouba o foco de quem está digitando no chat
      if (document.activeElement?.id !== 'chat-input') el.answerInput.focus();
    }
  }

  const hintsAvailable = match.phase === 'question' && round ? (question?.hintsAvailable ?? 0) : 0;
  el.hintBtn.hidden = !state.room.rules.hints || hintsAvailable === 0;
  if (!el.hintBtn.hidden) {
    const used = round.hints.length;
    el.hintBtn.textContent = `💡 Pista ${used}/${hintsAvailable}`;
    el.hintBtn.disabled = !canAnswer || used >= hintsAvailable;
    const penalty = state.room.rules.hintPenalty;
    el.hintBtn.title = penalty ? `Cada pista custa ${plural(penalty, 'ponto')}` : 'Pistas grátis nesta sala';
  }
}

function answerPlaceholder(match, round) {
  if (match.phase === 'countdown') return 'Prepare-se…';
  if (!round) return 'Você entra na próxima pergunta…';
  if (round.status === 'correct') return `✓ Você acertou! +${round.points}`;
  if (round.status === 'locked') return '🔒 Você já usou sua tentativa';
  if (match.phase !== 'question') return 'Aguarde a próxima pergunta…';
  return round.singleAttempt ? 'Digite sua resposta (só uma tentativa)…' : 'Digite sua resposta…';
}

// ——— barra de status e cronômetro (a cada quadro) ———

function frame() {
  const state = app.state;
  if (state) {
    const now = connection.clock.now();
    const text = statusText(state, now);
    if (el.status.textContent !== text) el.status.textContent = text;
    updateTimer(state, now);
    stage.tick(now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function secondsLeft(until, now) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function statusText(state, now) {
  const match = state.match;
  const room = state.room;
  if (!match) {
    if (room.autoStartAt) {
      const s = secondsLeft(room.autoStartAt, now);
      return state.results ? `🏆 Fim de jogo! Nova partida em ${s}s` : `🚀 A partida começa em ${s}s…`;
    }
    if (room.poolSize === 0) return '⚠️ Nenhuma pergunta com os filtros atuais';
    if (room.playersNeeded > 0) {
      return `⏳ À espera de mais ${room.playersNeeded} ${room.playersNeeded === 1 ? 'jogador' : 'jogadores'}…`;
    }
    return state.results ? '🏆 Fim de jogo!' : '⏳ Aguardando jogadores…';
  }
  if (match.phase === 'countdown') return '🎬 Prepare-se!';
  const total = match.totalRounds ? ` de ${match.totalRounds}` : '';
  const goal = match.scoreGoal ? ` · objetivo: ${match.scoreGoal} pts` : '';
  if (match.phase === 'question') {
    return `Rodada ${match.roundNumber}${total} · ⏱ ${secondsLeft(match.phaseEndsAt, now)}s${goal}`;
  }
  if (match.phase === 'reveal' && match.reveal) {
    const { correctCount, playerCount } = match.reveal;
    if (correctCount === 0) return '⌛ Ninguém acertou essa!';
    if (correctCount === playerCount) return `🎉 ${playerCount === 1 ? 'Acertou!' : 'Todo mundo acertou!'}`;
    return `✅ ${correctCount} de ${playerCount} acertaram`;
  }
  return `Rodada ${match.roundNumber}${total}`;
}

function updateTimer(state, now) {
  const match = state.match;
  let ratio = 0;
  if (match?.phase === 'question' && match.question) {
    ratio = (match.phaseEndsAt - now) / match.question.durationMs;
  }
  ratio = Math.min(1, Math.max(0, ratio));
  el.timerFill.style.width = `${(ratio * 100).toFixed(2)}%`;
  el.timerFill.classList.toggle('low', match?.phase === 'question' && match.phaseEndsAt - now < 5000);
}

// ——— ações do jogador ———

el.answerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.answerInput.value.trim();
  if (!text) return;
  send({ t: 'answer', text });
  el.answerInput.value = '';
});

el.hintBtn.addEventListener('click', () => {
  send({ t: 'hint' });
  el.answerInput.focus();
});

el.joinBtn.addEventListener('click', () => send({ t: 'joinGame' }));
el.leaveBtn.addEventListener('click', () => send({ t: 'leaveGame' }));
el.leaveBtn2.addEventListener('click', () => {
  if (confirm('Sair do jogo? Você continua na sala assistindo.')) send({ t: 'leaveGame' });
});
el.editRules.addEventListener('click', () => selectTab('rules'));

function guessFeedback(result) {
  el.answerForm.classList.remove('wrong');
  switch (result.result) {
    case 'correct':
      el.answerForm.classList.add('correct');
      toast(`✓ Acertou! +${result.points}${result.isFirst ? ' — foi o primeiro!' : ''}`, 'good');
      break;
    case 'incorrect':
      void el.answerForm.offsetWidth; // reinicia a animação de "tremida"
      el.answerForm.classList.add('wrong');
      if (result.near) toast('Quase! Confira a grafia.');
      else if (!result.canRetry) toast('Errou — era sua única tentativa.', 'bad');
      break;
    case 'late':
    case 'closed':
      toast('⌛ O tempo acabou!', 'bad');
      break;
    case 'locked':
      toast('Você já usou sua tentativa nesta pergunta.');
      break;
    default:
      break;
  }
}

// ——— abas e avisos ———

const tabs = [...document.querySelectorAll('[data-tab]')];
function selectTab(name) {
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
}
for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.dataset.tab));
selectTab('chat');

let toastTimer = null;
function toast(text, tone = '') {
  el.toast.textContent = text;
  el.toast.className = `toast ${tone}`;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2200);
}
