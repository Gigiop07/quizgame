// Pequeno auxiliar para criar elementos sem innerHTML (todo texto vira textContent).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export function percent(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${Math.round(ratio * 100)}%`;
}
