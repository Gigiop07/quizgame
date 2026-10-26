// Coluna de jogadores: avatar, pontuação e o que aconteceu na rodada.

import { h, clear } from '../dom.js';
import { avatar } from './art.js';

export function renderPlayers(container, state) {
  const selfId = state.self?.id;
  if (state.players.length === 0) {
    clear(container, h('p', { class: 'players-empty' }, 'Ninguém entrou no jogo ainda.'), spectators(state));
    return;
  }
  const sorted = state.match ? [...state.players].sort((a, b) => b.score - a.score) : state.players;
  clear(container, sorted.map((p) => playerCard(p, p.id === selfId, state)), spectators(state));
}

function playerCard(player, isSelf, state) {
  const status = player.round?.status;
  const classes = ['player'];
  if (isSelf) classes.push('me');
  if (status === 'correct') classes.push('correct');
  if (!player.connected) classes.push('disconnected');
  if (player.eliminated) classes.push('eliminated');

  return h(
    'div',
    { class: classes.join(' ') },
    h('div', { class: 'avatar' }, avatar(), h('span', { class: 'score' }, player.score)),
    h(
      'div',
      { class: 'player-info' },
      h('span', { class: 'player-name', title: player.name }, player.isLeader ? '👑 ' : '', player.name),
      statusLine(player, state),
    ),
  );
}

function statusLine(player, state) {
  const lines = [];
  if (player.lives !== undefined) {
    const max = state.room.rules.lives;
    lines.push(
      h('span', { class: 'player-line' }, player.eliminated ? '💀 eliminado' : '❤️'.repeat(player.lives) + '🤍'.repeat(Math.max(0, max - player.lives))),
    );
  }
  const round = player.round;
  if (round?.status === 'correct') {
    lines.push(h('span', { class: 'player-line ok' }, `✓ acertou${round.points ? ` · +${round.points}` : ''}`));
  } else if (round?.lastGuess) {
    lines.push(h('span', { class: 'player-line guess', title: round.lastGuess }, round.status === 'locked' ? '🔒 ' : '', round.lastGuess));
  } else if (round?.status === 'locked') {
    lines.push(h('span', { class: 'player-line' }, '🔒 tentativa usada'));
  }
  if (!player.connected) lines.push(h('span', { class: 'player-line' }, 'desconectado…'));
  return lines;
}

function spectators(state) {
  const count = state.room.spectators;
  if (!count) return null;
  return h('div', { class: 'spectators' }, `👀 ${count} ${count === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`);
}
