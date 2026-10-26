// Palco central: logo na espera, contagem, pergunta/revelação e resultado final.
// Só reconstrói o DOM quando muda a "tela" (ex.: nova rodada); o resto é atualização pontual,
// para a imagem não recarregar e a animação não reiniciar.

import { h, clear, formatSeconds, percent, plural } from '../dom.js';
import { logo } from './art.js';

const ZOOM_START = 4;
const BLUR_START = 18;

export class Stage {
  constructor({ el, onMediaError, onStart }) {
    this.el = el;
    this.onMediaError = onMediaError;
    this.onStart = onStart;
    this.key = null;
    this.round = null; // referências aos elementos da rodada atual
  }

  render(state) {
    const match = state.match;
    const key = viewKey(state);
    if (key !== this.key) {
      this.key = key;
      this.round = null;
      if (!match) clear(this.el, state.results ? this.results(state) : this.idle(state));
      else if (match.phase === 'countdown') clear(this.el, this.countdown(state));
      else if (match.question) clear(this.el, this.roundView(state));
      else clear(this.el);
    }
    if (this.round) this.updateRound(state);
  }

  /** Chamado a cada quadro com a hora do servidor. */
  tick(now) {
    if (this.countdownEl) {
      const left = Math.max(1, Math.ceil((this.countdownEndsAt - now) / 1000));
      if (this.countdownEl.textContent !== String(left)) this.countdownEl.textContent = left;
    }
    const r = this.round;
    if (!r?.img || !r.effect) return;
    if (r.revealed) {
      r.img.style.transform = '';
      r.img.style.filter = '';
      return;
    }
    const progress = Math.min(1, Math.max(0, (now - r.startsAt) / (r.durationMs * 0.75)));
    if (r.effect.type === 'zoom') {
      r.img.style.transformOrigin = r.effect.origin ?? '50% 50%';
      r.img.style.transform = `scale(${ZOOM_START - (ZOOM_START - 1) * progress})`;
    } else if (r.effect.type === 'blur') {
      r.img.style.filter = `blur(${(BLUR_START * (1 - progress)).toFixed(1)}px)`;
    }
  }

  // ——— telas ———

  idle(state) {
    this.countdownEl = null;
    const lines = [];
    if (state.room.poolSize === 0) {
      lines.push(h('p', {}, '⚠ Nenhuma pergunta combina com os filtros atuais.'));
    } else {
      lines.push(h('p', {}, `${plural(state.room.poolSize, 'pergunta')} disponíveis com as regras atuais.`));
    }
    if (state.self?.isLeader && state.self.isPlayer && state.room.poolSize > 0) {
      lines.push(h('button', { type: 'button', class: 'btn btn-primary', onclick: this.onStart }, '▶ Começar agora'));
    }
    if (!state.self?.isPlayer) lines.push(h('p', {}, 'Clique em “Entrar no jogo” para participar.'));
    return h('div', { class: 'idle' }, h('div', { class: 'logo-slot' }, logo()), lines);
  }

  countdown(state) {
    this.countdownEndsAt = state.match.phaseEndsAt;
    this.countdownEl = h('div', { class: 'countdown-number' }, '3');
    return h(
      'div',
      { class: 'idle' },
      h('p', {}, `${state.match.modeName} — prepare-se!`),
      this.countdownEl,
      h('p', {}, state.room.modeDescription),
    );
  }

  roundView(state) {
    this.countdownEl = null;
    const { match } = state;
    const q = match.question;
    const total = match.totalRounds ? `/${match.totalRounds}` : '';
    const chips = h(
      'div',
      { class: 'chips' },
      h('span', { class: 'chip' }, `Rodada ${q.number}${total}`),
      h('span', { class: 'chip' }, `${q.categoryEmoji} ${q.categoryLabel}`),
      h('span', { class: `chip diff-${q.difficulty}` }, q.difficultyLabel),
      match.multiplier > 1 ? h('span', { class: 'chip' }, `pontos ×${match.multiplier}`) : null,
    );
    const hints = h('ul', { class: 'hints' });
    const revealSlot = h('div');
    const media = this.mediaView(q);
    const el = h('div', { class: 'round' }, chips, h('h2', { class: 'prompt' }, q.prompt), media.el, hints, revealSlot);
    this.round = {
      el,
      number: q.number,
      hints,
      revealSlot,
      hintCount: 0,
      revealed: false,
      startsAt: q.startsAt,
      durationMs: q.durationMs,
      img: media.img,
      effect: q.media.reveal,
    };
    return el;
  }

  mediaView(q) {
    const media = q.media;
    if (media.type === 'image') {
      const frame = h('div', { class: 'media-frame' });
      const img = h('img', { src: media.src, alt: media.alt, draggable: 'false' });
      img.addEventListener('error', () => {
        this.onMediaError();
        if (this.round) this.round.img = null;
        clear(
          frame,
          media.fallbackText
            ? h('p', { class: 'clue' }, media.fallbackText)
            : h('p', { class: 'media-fallback' }, '🖼️ A imagem não carregou. Esta rodada não vai contar para você.'),
        );
      });
      frame.append(img);
      return { el: h('div', { class: 'media' }, frame), img };
    }
    if (media.type === 'emoji') return { el: h('div', { class: 'media emoji-clue', 'aria-label': 'Emojis' }, media.text) };
    if (media.type === 'text' && media.style === 'quote') {
      return { el: h('div', { class: 'media' }, h('blockquote', { class: 'quote' }, media.text)) };
    }
    if (media.type === 'text') {
      return {
        el: h(
          'div',
          { class: 'media' },
          h('p', { class: 'clue' }, media.text),
          media.fallback ? h('p', { class: 'reveal-meta' }, '(imagem indisponível — pista em texto)') : null,
        ),
      };
    }
    return { el: h('div', { class: 'media' }) };
  }

  updateRound(state) {
    const r = this.round;
    const hints = state.match.me?.hints ?? [];
    if (hints.length !== r.hintCount) {
      r.hintCount = hints.length;
      clear(r.hints, hints.map((hint, i) => h('li', {}, `💡 Pista ${i + 1}: ${hint}`)));
    }
    const reveal = state.match.reveal;
    if (reveal && !r.revealed) {
      r.revealed = true;
      r.el.classList.add('revealed');
      clear(r.revealSlot, revealView(reveal, state));
    }
  }

  results(state) {
    this.countdownEl = null;
    return resultsView(state, this.onStart);
  }
}

function viewKey(state) {
  const match = state.match;
  if (match) {
    if (match.phase === 'countdown') return 'countdown';
    if (match.question) return `round:${match.roundNumber}`;
    return `match:${match.phase}`;
  }
  if (state.results) {
    const scores = state.results.ranking.map((r) => `${r.id}:${r.score}`).join(',');
    return `results:${state.results.roundsPlayed}:${scores}:${state.self?.isLeader}:${state.self?.isPlayer}`;
  }
  return `idle:${state.self?.isLeader}:${state.self?.isPlayer}:${state.room.poolSize}`;
}

function revealView(reveal, state) {
  const me = state.match.me;
  let mine = null;
  if (me?.status === 'correct') mine = h('span', { class: 'mark-correct' }, `✓ Você acertou! +${me.points}`);
  else if (me) mine = h('span', { class: 'mark-wrong' }, 'Não foi dessa vez.');

  const meta = [];
  if (reveal.firstCorrect) meta.push(`⚡ ${reveal.firstCorrect.name} acertou primeiro em ${formatSeconds(reveal.firstCorrect.timeMs)}`);
  meta.push(`${reveal.correctCount} de ${reveal.playerCount} ${reveal.playerCount === 1 ? 'acertou' : 'acertaram'}`);

  return h(
    'div',
    { class: 'reveal' },
    mine,
    h('span', { class: 'reveal-label' }, 'A resposta era'),
    h('span', { class: 'reveal-answer' }, reveal.answer),
    reveal.alternatives.length ? h('span', { class: 'reveal-alt' }, `Também valia: ${reveal.alternatives.join(' · ')}`) : null,
    reveal.explanation ? h('p', { class: 'reveal-explanation' }, reveal.explanation) : null,
    h('span', { class: 'reveal-meta' }, meta.join(' · ')),
    creditLine(reveal),
  );
}

function creditLine(reveal) {
  const parts = [];
  if (reveal.source?.url) {
    parts.push('Fonte: ', h('a', { href: reveal.source.url, target: '_blank', rel: 'noopener' }, reveal.source.attribution || 'link'));
  }
  const credit = reveal.credit;
  if (credit) {
    if (parts.length) parts.push(' · ');
    parts.push(
      'Imagem: ',
      h('a', { href: credit.sourceUrl, target: '_blank', rel: 'noopener' }, credit.author || 'autor desconhecido'),
      ' — ',
      credit.licenseUrl ? h('a', { href: credit.licenseUrl, target: '_blank', rel: 'noopener' }, credit.license) : credit.license,
      ', via Wikimedia Commons',
    );
  }
  return parts.length ? h('span', { class: 'reveal-meta' }, parts) : null;
}

// ——— resultado final ———

const REASONS = {
  completed: (r) => `Partida completa: ${plural(r.roundsPlayed, 'rodada')}.`,
  goal_reached: (r) => `${r.ranking[0]?.name} atingiu o objetivo de pontos!`,
  last_survivor: (r) => `${r.ranking[0]?.name} foi quem sobreviveu até o fim!`,
  all_eliminated: () => 'Todo mundo ficou sem vidas.',
  out_of_questions: (r) => `Acabaram as perguntas disponíveis com esses filtros (${plural(r.roundsPlayed, 'rodada')}).`,
  no_players: () => 'A partida foi encerrada porque os jogadores saíram.',
};

function resultsView(state, onStart) {
  const results = state.results;
  const selfId = state.self?.id;
  const me = results.ranking.find((r) => r.id === selfId);
  const survival = results.mode === 'sobrevivencia';
  const multiplayer = results.ranking.length > 1;

  return h(
    'div',
    { class: 'results' },
    h('h2', {}, multiplayer ? `🏆 ${results.ranking[0]?.name ?? ''} venceu!` : 'Fim de jogo!'),
    h('p', { class: 'reason' }, (REASONS[results.reason] ?? REASONS.completed)(results)),
    me ? myStats(me) : null,
    multiplayer || !me ? rankingTable(results, selfId, survival) : null,
    questionList(results, selfId),
    state.self?.isLeader && state.self.isPlayer
      ? h('div', { style: { textAlign: 'center' } }, h('button', { type: 'button', class: 'btn btn-primary', onclick: onStart }, '▶ Nova partida'))
      : null,
  );
}

function myStats(me) {
  const stat = (value, label) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
  return h(
    'section',
    {},
    h(
      'div',
      { class: 'stat-grid' },
      stat(me.score, 'pontos'),
      stat(me.correct, 'acertos'),
      stat(me.wrong, 'erradas'),
      stat(me.unanswered, 'sem resposta'),
      stat(percent(me.accuracy), 'taxa de acerto (entre as respondidas)'),
      stat(me.avgResponseMs === null ? '—' : formatSeconds(me.avgResponseMs), 'tempo médio de acerto'),
      stat(me.bestStreak, 'maior sequência'),
    ),
    me.bestCategories.length
      ? h('p', { class: 'reason' }, 'Melhores categorias: ', me.bestCategories.map((c) => `${c.label} (${c.correct}/${c.total})`).join(' · '))
      : null,
    me.cancelled ? h('p', { class: 'reason' }, `${plural(me.cancelled, 'rodada')} sem imagem não ${me.cancelled === 1 ? 'entrou' : 'entraram'} na conta.`) : null,
  );
}

function rankingTable(results, selfId, survival) {
  const head = ['#', 'Jogador', 'Pontos', 'Acertos', 'Erradas', 'Sem resp.', 'Taxa', 'Tempo médio', 'Sequência'];
  if (survival) head.push('Situação');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, head.map((label, i) => h('th', { class: i >= 2 ? 'num' : null }, label)))),
      h(
        'tbody',
        {},
        results.ranking.map((r) =>
          h(
            'tr',
            { class: r.id === selfId ? 'me' : null },
            h('td', {}, r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank),
            h('td', {}, r.name),
            h('td', { class: 'num' }, r.score),
            h('td', { class: 'num' }, r.correct),
            h('td', { class: 'num' }, r.wrong),
            h('td', { class: 'num' }, r.unanswered),
            h('td', { class: 'num' }, percent(r.accuracy)),
            h('td', { class: 'num' }, r.avgResponseMs === null ? '—' : formatSeconds(r.avgResponseMs)),
            h('td', { class: 'num' }, r.bestStreak),
            survival ? h('td', { class: 'num' }, r.eliminatedAtRound ? `saiu na rodada ${r.eliminatedAtRound}` : 'sobreviveu') : null,
          ),
        ),
      ),
    ),
  );
}

function questionList(results, selfId) {
  if (!results.questions.length) return null;
  return h(
    'section',
    {},
    h('h3', {}, 'Perguntas da partida'),
    h(
      'ol',
      { class: 'qlist' },
      results.questions.map((q) => {
        const mine = q.perPlayer[selfId];
        return h(
          'li',
          {},
          h('span', {}, `${q.number}.`),
          h(
            'span',
            {},
            h('span', { class: 'q-prompt' }, `${q.categoryLabel} · ${q.prompt}`),
            h('br'),
            h('span', { class: 'q-answer' }, q.answer),
          ),
          mine ? mark(mine) : h('span'),
        );
      }),
    ),
  );
}

function mark(outcome) {
  switch (outcome.status) {
    case 'correct':
      return h('span', { class: 'mark-correct' }, `✓ +${outcome.points}`);
    case 'wrong':
      return h('span', { class: 'mark-wrong' }, '✗');
    case 'cancelled':
      return h('span', { class: 'mark-none', title: 'A imagem não carregou' }, '⚠');
    default:
      return h('span', { class: 'mark-none', title: 'Sem resposta' }, '—');
  }
}
