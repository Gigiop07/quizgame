// Chat da sala.

import { h } from '../dom.js';

export class Chat {
  constructor({ log, form, input, send }) {
    this.log = log;
    this.input = input;
    this.seen = new Set();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send(text);
      input.value = '';
    });
  }

  reset(messages) {
    this.log.replaceChildren();
    this.seen.clear();
    for (const message of messages) this.add(message);
  }

  add(message) {
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    this.log.append(line(message));
    while (this.log.childElementCount > 150) this.log.firstElementChild.remove();
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}

function line(message) {
  if (message.system) return h('div', { class: 'system' }, message.text);
  if (message.hidden) {
    return h('div', { class: 'hidden-msg' }, h('span', { class: 'author' }, message.author), ': 🤐 mensagem escondida (tinha a resposta)');
  }
  return h('div', {}, h('span', { class: 'author' }, message.author), ': ', message.text);
}
