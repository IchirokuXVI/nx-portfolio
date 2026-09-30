/**
 * Every colour the canvas draws, as a custom property with a Day and a Night
 * default (editor plan 0001, section 2). The defaults are the mock's
 * (`apps/velista/plans/mocks/shop-map/`). A host restyles by setting the
 * property on the host element or any ancestor, because a set property
 * outranks the default: each rule reads `var(--shop-map-x, <default>)`, and
 * the defaults live on private properties the host never needs to name.
 *
 * The theme follows `prefers-color-scheme`, and `data-theme="day"` or
 * `data-theme="night"` on the host or any ancestor overrides it. The closest
 * one wins: the mount copies it onto the root as `data-sm-theme`, which is
 * what these rules read.
 */
export const SHOP_MAP_PROPERTIES = {
  // The twelve of the plan.
  walkway: ['#e8eef8', '#131a2b'],
  'walkway-dot': ['rgba(29, 61, 99, 0.22)', 'rgba(188, 214, 245, 0.16)'],
  area: ['#f1e4cb', '#2d2618'],
  'area-border': ['#9c7f4b', '#8a7148'],
  'area-text': ['#3f3220', '#eadcc0'],
  grid: ['rgba(82, 90, 120, 0.16)', 'rgba(255, 255, 255, 0.07)'],
  walked: ['#fbefd9', '#2b2416'],
  suggestion: ['#8a5a12', '#ffb454'],
  unconfirmed: ['rgba(124, 58, 237, 0.34)', 'rgba(167, 139, 250, 0.38)'],
  person: ['#ffb454', '#ffb454'],
  badge: ['#ffb454', '#ffb454'],
  'badge-done': ['#047857', '#6ee7b7'],
  // The rest of what the mock draws.
  ground: ['#e3e6ee', '#11141f'],
  counter: ['#f6dccb', '#3a2216'],
  'counter-border': ['#b5643a', '#8a4a2a'],
  'counter-text': ['#7a3412', '#f5c8ab'],
  checkout: ['#e6e8ef', '#1e2231'],
  'checkout-border': ['#aab0c2', '#3c4358'],
  blocked: ['#4b5268', '#6f7899'],
  'suggestion-fill': ['rgba(255, 180, 84, 0.30)', 'rgba(255, 180, 84, 0.22)'],
  'person-ring': ['#ffffff', '#ffffff'],
  'person-cone': ['rgba(255, 180, 84, 0.40)', 'rgba(255, 180, 84, 0.40)'],
  pin: ['#ffffff', '#1a1e2e'],
  'pin-ink': ['#111420', '#f7f8fc'],
  note: ['#5b21b6', '#c4b5fd'],
  selected: ['#ffb454', '#ffb454'],
  handle: ['#ffffff', '#161a28'],
  'handle-border': ['#111420', '#f7f8fc'],
  tag: ['#111420', '#f7f8fc'],
  'tag-text': ['#f7f8fc', '#0a0c14'],
  'badge-text': ['#0a0c14', '#0a0c14'],
  'badge-done-text': ['#ffffff', '#0a0c14'],
  'badge-ring': ['#ffffff', '#161a28'],
  entrance: ['#111420', '#f7f8fc'],
  'entrance-text': ['#f7f8fc', '#0a0c14'],
  refused: ['#b91c1c', '#fca5a5'],
  // The drawn shopper look (velista plan 0128), from the board with drawn assets.
  'product-1': ['#d9644a', '#b5553f'],
  'product-2': ['#3f9b8f', '#347f76'],
  'product-3': ['#e0b243', '#b8923a'],
  crate: ['#7bb04a', '#628f3b'],
  glass: ['rgba(120, 170, 210, 0.55)', 'rgba(120, 170, 210, 0.35)'],
  door: ['#525a78', '#98a0bb'],
  'label-ink-dark': ['#111420', '#111420'],
  'label-ink-light': ['#f7f8fc', '#f7f8fc'],
} as const satisfies Record<string, readonly [string, string]>;

export type ShopMapProperty = keyof typeof SHOP_MAP_PROPERTIES;

/** `var(--shop-map-<name>, <this theme's default>)`, for a rule or an attribute. */
export const cssVar = (name: ShopMapProperty) =>
  `var(--shop-map-${name}, var(--smd-${name}))`;

function defaults(theme: 0 | 1): string {
  return Object.entries(SHOP_MAP_PROPERTIES)
    .map(([name, pair]) => `--smd-${name}:${pair[theme]};`)
    .join('');
}

/** The one stylesheet a mount inserts beside its canvas, scoped to `.sm-root`. */
export function shopMapCss(): string {
  const day = defaults(0);
  const night = defaults(1);
  return [
    `.sm-root{${day}position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;font-family:inherit}`,
    `@media (prefers-color-scheme: dark){.sm-root{${night}}}`,
    `.sm-root[data-sm-theme="day"]{${day}}`,
    `.sm-root[data-sm-theme="night"]{${night}}`,
    `.sm-root>svg{display:block;width:100%;height:100%}`,
    `.sm-ground{fill:${cssVar('ground')}}`,
    `.sm-walked{fill:${cssVar('walked')}}`,
    `.sm-grid-line{stroke:${cssVar('grid')};stroke-width:1;fill:none}`,
    `.sm-walkway-base{fill:${cssVar('walkway')}}`,
    `.sm-walkway-dot{fill:${cssVar('walkway-dot')}}`,
    `.sm-area{fill:${cssVar('area')};stroke:${cssVar('area-border')};stroke-width:2}`,
    `.sm-area.sm-counter{fill:${cssVar('counter')};stroke:${cssVar('counter-border')}}`,
    `.sm-area.sm-checkout{fill:${cssVar('checkout')};stroke:${cssVar('checkout-border')}}`,
    `.sm-area.sm-blocked{fill:${cssVar('blocked')};stroke:none}`,
    `.sm-area.sm-entrance{fill:${cssVar('walked')};stroke:${cssVar('pin-ink')};stroke-dasharray:4 3}`,
    `.sm-area.sm-refused{fill:${cssVar('refused')};fill-opacity:.28;stroke:${cssVar('refused')};stroke-dasharray:none}`,
    `.sm-label{fill:${cssVar('area-text')};font-size:12px;font-weight:600;text-anchor:middle;dominant-baseline:central;pointer-events:none}`,
    `.sm-label.sm-counter{fill:${cssVar('counter-text')}}`,
    `.sm-label.sm-dim{opacity:.62;font-weight:500}`,
    `.sm-sug{stroke:${cssVar('suggestion')};stroke-width:2;stroke-dasharray:6 4}`,
    `.sm-sug-stripe{fill:${cssVar('suggestion-fill')}}`,
    `.sm-sug-label{fill:${cssVar('suggestion')};font-size:12px;font-weight:600;text-anchor:middle;dominant-baseline:central;pointer-events:none}`,
    `.sm-unconfirmed{fill:none;stroke:${cssVar('unconfirmed')};stroke-linecap:square;stroke-linejoin:miter}`,
    `.sm-resume{fill:none;stroke:${cssVar('note')};stroke-width:2;stroke-dasharray:4 3}`,
    `.sm-pin{fill:${cssVar('pin')};stroke:${cssVar('pin-ink')};stroke-width:2}`,
    `.sm-pin-glyph{fill:none;stroke:${cssVar('pin-ink')};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}`,
    `.sm-note{fill:${cssVar('pin')};stroke:${cssVar('note')};stroke-width:2}`,
    `.sm-note-glyph{fill:none;stroke:${cssVar('note')};stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}`,
    `.sm-cone{fill:${cssVar('person-cone')}}`,
    `.sm-person{fill:${cssVar('person')};stroke:${cssVar('person-ring')};stroke-width:3}`,
    `.sm-selected{fill:none;stroke:${cssVar('selected')};stroke-width:3}`,
    `.sm-handle{fill:${cssVar('handle')};stroke:${cssVar('handle-border')};stroke-width:2}`,
    `.sm-hit{fill:transparent}`,
    `.sm-tag{fill:${cssVar('tag')}}`,
    `.sm-tag-text{fill:${cssVar('tag-text')};font-size:12px;font-weight:700;text-anchor:middle;dominant-baseline:central}`,
    `.sm-held{fill:${cssVar('selected')};fill-opacity:.35;stroke:${cssVar('pin-ink')};stroke-width:2}`,
    `.sm-badge{fill:${cssVar('badge')};stroke:${cssVar('badge-ring')};stroke-width:2}`,
    `.sm-badge-text{fill:${cssVar('badge-text')};font-size:11px;font-weight:700;text-anchor:middle;dominant-baseline:central}`,
    `.sm-badge.sm-done{fill:${cssVar('badge-done')}}`,
    `.sm-badge-text.sm-done{fill:${cssVar('badge-done-text')}}`,
    `.sm-badge-tick{fill:none;stroke:${cssVar('badge-done-text')};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}`,
    `.sm-entrance-chip{fill:${cssVar('entrance')}}`,
    `.sm-entrance-text{fill:${cssVar('entrance-text')};font-size:12px;font-weight:700;dominant-baseline:central}`,
    `.sm-entrance-glyph{fill:none;stroke:${cssVar('entrance-text')};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}`,
    `.sm-faded{opacity:.35}`,
    `.sm-product-1{fill:${cssVar('product-1')}}`,
    `.sm-product-2{fill:${cssVar('product-2')}}`,
    `.sm-product-3{fill:${cssVar('product-3')}}`,
    `.sm-crate{fill:${cssVar('crate')}}`,
    `.sm-glass{fill:${cssVar('glass')}}`,
    `.sm-door{fill:${cssVar('door')}}`,
    `.sm-shelf-line{fill:${cssVar('area-border')}}`,
    `.sm-till{fill:${cssVar('area')};stroke:${cssVar('area-text')};stroke-width:1.6;stroke-linejoin:round}`,
    `.sm-till-belt{fill:none;stroke-dasharray:2 2}`,
    `.sm-label-tag{fill:${cssVar('area')}}`,
    `.sm-label.sm-ink-dark{fill:${cssVar('label-ink-dark')}}`,
    `.sm-label.sm-ink-light{fill:${cssVar('label-ink-light')}}`,
  ].join('\n');
}
