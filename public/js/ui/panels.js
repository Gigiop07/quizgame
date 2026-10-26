// Abas "Sala" (código e convite) e "Como jogar / créditos".

import { h, clear } from '../dom.js';

export function renderRoomPanel(el, state, notify) {
  const link = `${location.origin}${location.pathname}#${state.room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Link copiado!');
    } catch {
      notify('Não deu para copiar — selecione o link e copie manualmente.');
    }
  };
  clear(
    el,
    h('div', { class: 'setting-head' }, '🏠 Código da sala'),
    h('div', { class: 'setting-body' }, h('div', { class: 'room-code' }, state.room.code)),
    h('div', { class: 'setting-head' }, '🔗 Convide a galera'),
    h(
      'div',
      { class: 'setting-body' },
      h('p', { class: 'setting-desc' }, 'Mande este link (ou o código) para quem vai jogar.'),
      h('div', { class: 'copy-row' }, h('input', { type: 'text', value: link, readonly: true, onfocus: (e) => e.target.select() }), h('button', { type: 'button', onclick: copy }, 'Copiar')),
      h('p', { class: 'setting-desc' }, 'Para jogar com amigos fora da sua rede, o servidor precisa estar publicado na internet (veja o README).'),
    ),
  );
}

export function renderAboutPanel(el) {
  clear(
    el,
    h('div', { class: 'intro' }, h('h3', {}, 'Como jogar'), h('p', {}, 'A cada rodada aparece uma imagem, frase, sequência de emojis ou descrição. Digite a resposta antes do tempo acabar.')),
    h('div', { class: 'setting-head' }, '🏅 Pontuação'),
    h(
      'div',
      { class: 'setting-body' },
      h('p', { class: 'setting-desc' }, 'Quem acerta primeiro ganha 10 pontos. Depois disso, cada acerto vale de 9 a 1, conforme o tempo que passou desde o primeiro acerto. Respostas erradas não tiram pontos.'),
      h('p', { class: 'setting-desc' }, 'Pistas ajudam, mas custam pontos (um acerto vale no mínimo 1).'),
    ),
    h('div', { class: 'setting-head' }, '⌨️ Respostas'),
    h(
      'div',
      { class: 'setting-body' },
      h('p', { class: 'setting-desc' }, 'Acentos, maiúsculas, pontuação e artigos no começo (“o”, “a”, “the”) não importam. Nomes originais e brasileiros costumam valer. Pequenos erros de digitação podem ser perdoados, dependendo das regras da sala.'),
    ),
    h('div', { class: 'setting-head' }, '🖼️ Créditos das imagens'),
    h(
      'div',
      { class: 'setting-body' },
      h('p', { class: 'setting-desc' }, 'As fotos vêm do Wikimedia Commons, sob licenças livres (domínio público, CC0, CC BY ou CC BY-SA). O autor e a licença de cada imagem aparecem quando a resposta é revelada.'),
      h('p', { class: 'setting-desc' }, 'Na Lata! é um projeto independente, inspirado na dinâmica do PopSauce (JKLM), sem ligação com ele.'),
    ),
  );
}
