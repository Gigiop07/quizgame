// Painel "Editar regras". Só quem lidera a sala edita, e só entre partidas.
// O DOM é montado uma vez; a cada estado só os valores são atualizados (sem atrapalhar
// quem está mexendo num controle).

import { h, clear, plural } from '../dom.js';
import { RULE_DEFS } from '/core/rules.js';
import { MODES } from '/core/modes.js';
import { SCORING_MODES } from '/core/scoring.js';
import { DURATION_BY_DIFFICULTY, DIFFICULTY_LABELS } from '/core/config.js';

const OP_SYMBOL = { union: '∪', intersection: '∩', exclusion: '∖' };
const OP_TITLE = {
  union: 'União: inclui perguntas com esta etiqueta',
  intersection: 'Interseção: exige esta etiqueta',
  exclusion: 'Exclusão: remove perguntas com esta etiqueta',
};

export class RulesPanel {
  constructor({ el, send }) {
    this.el = el;
    this.send = send;
    this.controls = [];
    this.rules = null;
    this.editable = false;
    this.filtersKey = null;
    this.tags = [];
    this.build();
  }

  setTags(tags) {
    this.tags = tags;
    clear(this.datalist, tags.map((t) => h('option', { value: t.tag }, `${t.count}`)));
    clear(
      this.quickTags,
      tags.slice(0, 14).map((t) =>
        h(
          'button',
          { type: 'button', title: plural(t.count, 'pergunta'), 'aria-label': `Filtrar por ${t.tag}`, onclick: () => this.addFilter(t.tag, 'union') },
          t.tag,
        ),
      ),
    );
  }

  change(changes) {
    if (this.editable) this.send(changes);
  }

  build() {
    const section = (icon, title, desc, ...body) => {
      const el = h(
        'section',
        {},
        h('div', { class: 'setting-head' }, `${icon} ${title}`),
        h('div', { class: 'setting-body' }, desc ? h('p', { class: 'setting-desc' }, desc) : null, ...body),
      );
      return el;
    };

    this.lockedNote = h('p', { class: 'locked-note' });
    this.poolText = h('span');
    this.modeDesc = h('p', { class: 'setting-desc' });
    this.datalist = h('datalist', { id: 'tag-options' });
    this.quickTags = h('div', { class: 'quick-tags' });
    this.filterList = h('div', { class: 'filter-list' });
    this.filterInput = h('input', { type: 'text', list: 'tag-options', placeholder: 'Etiqueta (ex.: memes, brasil, anos 90)' });

    const filterButtons = Object.keys(OP_SYMBOL).map((op) =>
      h('button', { type: 'button', title: OP_TITLE[op], onclick: () => this.addFilter(this.filterInput.value, op) }, OP_SYMBOL[op]),
    );
    this.filterButtons = filterButtons;
    this.filterInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addFilter(this.filterInput.value, 'union');
      }
    });

    const modeSelect = this.select('mode', Object.values(MODES).map((m) => [m.id, m.name]));
    const roundsSection = section('🔁', 'Número de rodadas', 'Quantas perguntas a partida terá.', this.number('rounds'));
    const goalSection = section('🎯', 'Objetivo de pontuação (pontos)', 'O primeiro jogador a atingir esse número de pontos vence.', this.number('scoreGoal'));
    const livesSection = section('❤️', 'Vidas', 'Quantas rodadas cada jogador pode errar ou deixar passar.', this.number('lives'));
    const decayRow = h(
      'div',
      { class: 'setting-body', style: { padding: 0 } },
      h('p', { class: 'setting-desc' }, 'Depois do primeiro acerto (10 pontos), os próximos valem de 9 até 1, caindo ao longo deste intervalo (segundos).'),
      this.number('decaySeconds'),
    );
    const durationFixed = this.number('duration');
    const durationAuto = h(
      'p',
      { class: 'setting-desc' },
      Object.entries(DURATION_BY_DIFFICULTY)
        .map(([d, s]) => `${DIFFICULTY_LABELS[d]}: ${s}s`)
        .join(' · '),
    );
    const hintOptions = h(
      'div',
      { class: 'setting-body', style: { padding: 0 } },
      h('p', { class: 'setting-desc' }, 'Máximo de pistas por pergunta'),
      this.number('maxHints'),
      h('p', { class: 'setting-desc' }, 'Pontos perdidos por pista usada (um acerto nunca vale menos de 1)'),
      this.number('hintPenalty'),
    );

    this.visibility = [
      { el: roundsSection, when: (r) => r.mode === 'classico' || r.mode === 'especialista' },
      { el: goalSection, when: (r) => r.mode === 'corrida' },
      { el: livesSection, when: (r) => r.mode === 'sobrevivencia' },
      { el: decayRow, when: (r) => r.scoring === 'speed' },
      { el: durationFixed, when: (r) => r.durationMode === 'fixed' },
      { el: durationAuto, when: (r) => r.durationMode === 'difficulty' },
      { el: hintOptions, when: (r) => r.hints },
    ];

    clear(
      this.el,
      h(
        'div',
        { class: 'intro' },
        h('h3', {}, 'Como jogar'),
        h('p', {}, 'Adivinhe de onde veio cada frase ou imagem. Quanto mais rápido você achar a resposta, maior a sua pontuação!'),
      ),
      this.lockedNote,
      section('🎮', 'Modo de jogo', null, modeSelect, this.modeDesc),
      section(
        '🏷️',
        'Filtrar por categoria',
        null,
        h('p', { class: 'setting-desc' }, 'Apenas desafios com esses filtros serão escolhidos. ', this.poolText),
        this.filterList,
        h('div', { class: 'filter-add' }, this.filterInput, filterButtons),
        this.quickTags,
        this.datalist,
      ),
      roundsSection,
      goalSection,
      livesSection,
      section('🎲', 'Pontuação', 'Controle como os pontos são distribuídos.', this.select('scoring', Object.entries(SCORING_MODES)), decayRow),
      section(
        '⏲️',
        'Duração dos desafios (segundos)',
        'Jogadores têm esse tempo para adivinhar.',
        this.segmented('durationMode', [
          ['difficulty', 'Pela dificuldade'],
          ['fixed', 'Fixa'],
        ]),
        durationFixed,
        durationAuto,
      ),
      section(
        '🎯',
        'Tentativas',
        'Se cada jogador pode chutar várias vezes ou só uma por pergunta.',
        this.segmented('attempts', [
          ['unlimited', 'Ilimitadas'],
          ['single', 'Uma só'],
        ]),
      ),
      section(
        '🎀',
        'Atalhos',
        'Se abreviações comuns e escritas diferentes são aceitas.',
        this.segmented('shortcuts', [
          [true, 'Permitir'],
          [false, 'Rejeitar'],
        ]),
      ),
      section(
        '✍️',
        'Erros de digitação',
        'Se pequenos erros de digitação são perdoados (nunca em nomes curtos ou números).',
        this.segmented('typoTolerance', [
          [true, 'Tolerar'],
          [false, 'Rejeitar'],
        ]),
      ),
      section(
        '🔍',
        'Visibilidade das respostas',
        'Se respostas erradas de outros jogadores aparecem ou não.',
        this.segmented('showGuesses', [
          [true, 'Mostrar'],
          [false, 'Esconder'],
        ]),
      ),
      section(
        '💡',
        'Pistas',
        'Cada jogador pode pedir pistas durante a pergunta, em troca de pontos.',
        this.segmented('hints', [
          [true, 'Ativadas'],
          [false, 'Desativadas'],
        ]),
        hintOptions,
      ),
      section('👥', 'Jogadores para começar', 'A partida começa sozinha quando houver esse número de jogadores.', this.number('minPlayers')),
    );
  }

  select(key, options) {
    const el = h('select', {}, options.map(([value, label]) => h('option', { value }, label)));
    el.addEventListener('change', () => this.change({ [key]: el.value }));
    this.controls.push({ els: [el], update: (rules) => (el.value = rules[key]) });
    return el;
  }

  number(key) {
    const def = RULE_DEFS[key];
    const input = h('input', { type: 'number', min: def.min, max: def.max, step: 1 });
    const range = h('input', { type: 'range', min: def.min, max: def.max, step: 1, 'aria-label': 'Ajustar valor' });
    range.addEventListener('input', () => (input.value = range.value));
    range.addEventListener('change', () => this.change({ [key]: Number(range.value) }));
    input.addEventListener('change', () => {
      this.change({ [key]: Number(input.value) });
      input.blur(); // deixa o valor final (já limitado pelo servidor) aparecer
    });
    const update = (rules) => {
      input.value = rules[key];
      range.value = rules[key];
    };
    this.controls.push({ els: [input, range], update, keepWhileFocused: true });
    return h('div', { class: 'number-row' }, input, range);
  }

  segmented(key, options) {
    const buttons = options.map(([value, label]) =>
      h('button', { type: 'button', onclick: () => this.change({ [key]: value }) }, label),
    );
    const update = (rules) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(rules[key] === options[i][0])));
    this.controls.push({ els: buttons, update });
    return h('div', { class: 'segmented', role: 'group' }, buttons);
  }

  addFilter(tag, op) {
    const clean = String(tag ?? '').trim();
    if (!clean || !this.editable) return;
    const filters = (this.rules.filters ?? []).filter((f) => f.tag.toLowerCase() !== clean.toLowerCase());
    this.change({ filters: [...filters, { tag: clean, op }] });
    this.filterInput.value = '';
  }

  removeFilter(index) {
    this.change({ filters: this.rules.filters.filter((_, i) => i !== index) });
  }

  update(state) {
    const rules = state.room.rules;
    this.rules = rules;
    this.editable = Boolean(state.self?.isLeader) && !state.match;

    const leader = state.players.find((p) => p.isLeader)?.name;
    if (state.match) this.lockedNote.textContent = '🔒 As regras só podem mudar entre partidas.';
    else if (!state.self?.isLeader) this.lockedNote.textContent = `🔒 Só quem lidera a sala (👑${leader ? ` ${leader}` : ''}) pode mudar as regras.`;
    this.lockedNote.hidden = this.editable;

    this.modeDesc.textContent = state.room.modeDescription;
    this.poolText.textContent = `Atualmente ativos: ${state.room.poolSize} de ${state.room.totalQuestions}.`;

    for (const control of this.controls) {
      const focused = control.els.includes(document.activeElement);
      // não sobrescreve um número/slider enquanto a pessoa ainda está mexendo nele
      if (!(focused && control.keepWhileFocused) && !(focused && control.els[0].tagName === 'SELECT')) {
        control.update(rules);
      }
      for (const el of control.els) el.disabled = !this.editable;
    }
    this.filterInput.disabled = !this.editable;
    for (const b of this.filterButtons) b.disabled = !this.editable;
    for (const b of this.quickTags.querySelectorAll('button')) b.disabled = !this.editable;
    for (const { el, when } of this.visibility) el.hidden = !when(rules);

    const filtersKey = JSON.stringify([rules.filters, this.editable]);
    if (filtersKey !== this.filtersKey) {
      this.filtersKey = filtersKey;
      clear(
        this.filterList,
        rules.filters.map((f, i) =>
          h(
            'div',
            { class: `filter-chip ${f.op}`, title: OP_TITLE[f.op] },
            h('span', { class: 'op' }, OP_SYMBOL[f.op]),
            h('span', {}, f.tag),
            this.editable ? h('button', { type: 'button', 'aria-label': `Remover ${f.tag}`, onclick: () => this.removeFilter(i) }, '✕') : h('span'),
          ),
        ),
      );
    }
  }
}
