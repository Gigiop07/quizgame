// Logo e avatar em SVG (arte própria do jogo).

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

export function logo() {
  return svg(`
<svg xmlns="${SVG_NS}" viewBox="0 0 520 250" role="img" aria-label="Na Lata!">
  <g stroke="#3a2337" stroke-width="6" stroke-linejoin="round">
    <path d="M58 52 l8 18 l20 -4 l-14 15 l10 18 l-19 -8 l-14 15 l2 -21 l-19 -8 l20 -6 z" fill="#e8402c"/>
    <circle cx="36" cy="112" r="9" fill="#e8402c"/>
    <circle cx="468" cy="200" r="11" fill="#f2c12e"/>
    <circle cx="492" cy="178" r="7" fill="#f2c12e"/>
    <path d="M430 206 l6 14 l15 -3 l-10 11 l8 13 l-14 -6 l-10 11 l1 -15 l-14 -6 l15 -4 z" fill="#f2c12e"/>
    <g transform="translate(360 22) rotate(12)">
      <path d="M6 22 Q6 8 20 6 H76 Q90 8 90 22 V170 Q90 184 76 186 H20 Q6 184 6 170 Z" fill="#e8402c"/>
      <path d="M6 82 H90 V122 H6 Z" fill="#f2c12e"/>
      <ellipse cx="48" cy="12" rx="38" ry="10" fill="#e6e0ea"/>
      <path d="M40 4 q8 -10 18 -2 l-4 8 q-6 -4 -10 0 z" fill="#c9c1cf" stroke-width="4"/>
      <path d="M18 34 V156" stroke="#fff" stroke-opacity=".4" stroke-width="8" stroke-linecap="round"/>
    </g>
  </g>
  <text x="250" y="182" text-anchor="middle" font-family="Lobster, 'Brush Script MT', cursive" font-size="118"
        fill="#fff" stroke="#3a2337" stroke-width="16" stroke-linejoin="round" paint-order="stroke">Na Lata!</text>
</svg>`);
}

export function avatar() {
  return svg(`
<svg xmlns="${SVG_NS}" viewBox="0 0 58 58" aria-hidden="true">
  <rect width="58" height="58" fill="#352d34"/>
  <circle cx="29" cy="22" r="10" fill="#d9d4d8"/>
  <path d="M10 50 Q12 34 29 34 Q46 34 48 50 Z" fill="#d9d4d8"/>
</svg>`);
}
