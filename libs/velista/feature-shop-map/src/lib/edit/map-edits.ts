import { InjectionToken, type Signal } from '@angular/core';
import { SHOP_MAP_PROPERTIES } from '@portfolio/luna-shopper/shop-map/editor';
import {
  foldWalk,
  validateShopMapV2,
  type AreaColour,
  type AreaKind,
  type MapArea,
  type ShopMapDocumentV2,
  type WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import type { AppTheme } from '@portfolio/velista/models';

/**
 * The pure half of editing a shop's map by hand (velista `0123`): what the long
 * press menu offers over what is under the finger, the events each action makes,
 * the colours an area can take and the words of its kind and size. Pure, so the
 * recording screen of velista `0126` uses the same rules while walking, and the
 * spec reads them without a page.
 */

/** The squares the grid draws, in metres. */
export const MAP_SQUARE_METRES = 0.5;

/** The seven actions of the long press menu, in the order the menu lists them. */
export const HOLD_ACTIONS = [
  'shelf',
  'counter',
  'blocked',
  'path',
  'note',
  'section',
  'erase',
] as const;
export type HoldAction = (typeof HOLD_ACTIONS)[number];

/** The four actions that make the pressed square, or the area on it, one kind. */
export type HoldKindAction = Extract<
  HoldAction,
  'shelf' | 'counter' | 'blocked' | 'path'
>;

/** A long press, as the canvas reports it. */
export interface HoldPress {
  /** Metres, where the finger was. */
  readonly at: { readonly x: number; readonly y: number };
  /** The area under the finger, or null for the floor. */
  readonly area: MapArea | null;
  /** Where the finger was on the screen, for anchoring the menu. */
  readonly client: { readonly x: number; readonly y: number };
}

const KIND_OF: Readonly<Record<HoldKindAction, AreaKind>> = {
  shelf: 'shelf',
  counter: 'counter',
  blocked: 'blocked',
  path: 'path',
};

/** Only shelves and counters carry a section (the rule `SECTION_ON_WRONG_KIND`). */
export function takesSection(kind: AreaKind): boolean {
  return kind === 'shelf' || kind === 'counter';
}

/**
 * The actions that apply to what is under the finger. Making something the kind
 * it already is does not apply, a section needs a shelf or a counter, and only
 * an area can be erased.
 */
export function holdActionsFor(area: MapArea | null): HoldAction[] {
  return HOLD_ACTIONS.filter((action) => {
    switch (action) {
      case 'shelf':
      case 'counter':
      case 'blocked':
      case 'path':
        return area === null || area.kind !== KIND_OF[action];
      case 'note':
        return true;
      case 'section':
        return area !== null && takesSection(area.kind);
      case 'erase':
        return area !== null;
    }
  });
}

/** The corner of the square the finger is on, in metres. */
export function heldSquare(at: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  const snap = (v: number) =>
    Math.round(Math.floor(v / MAP_SQUARE_METRES) * MAP_SQUARE_METRES * 100) /
    100;
  return { x: snap(at.x), y: snap(at.y) };
}

/**
 * The events a kind action or Erase makes. On the floor a kind action draws the
 * pressed square as a new area of that kind, which the mapper then resizes; on
 * an area it changes the area's kind, dropping a section the new kind cannot
 * carry. Erase removes the area.
 */
export function holdEvents(
  action: HoldKindAction | 'erase',
  press: Pick<HoldPress, 'at' | 'area'>,
  createId: () => string
): WalkEvent[] {
  const area = press.area;
  if (action === 'erase') {
    return area === null ? [] : [{ type: 'area-removed', id: area.id }];
  }
  const kind = KIND_OF[action];
  if (area === null) {
    const square = heldSquare(press.at);
    return [
      {
        type: 'area-put',
        area: {
          id: createId(),
          kind,
          x: square.x,
          y: square.y,
          w: MAP_SQUARE_METRES,
          h: MAP_SQUARE_METRES,
          colour: { mode: 'default' },
          origin: 'drawn',
        },
      },
    ];
  }
  const { section, ...rest } = area;
  const changed: MapArea =
    takesSection(kind) && section !== undefined
      ? { ...rest, section, kind }
      : { ...rest, kind };
  return [{ type: 'area-put', area: changed }];
}

/** A note mark at a point, at the log time the edit sits at. */
export function noteEvent(
  at: { readonly x: number; readonly y: number },
  text: string,
  logMs: number,
  id: string
): WalkEvent {
  return {
    type: 'mark-put',
    mark: {
      id,
      kind: 'note',
      x: Math.round(at.x * 100) / 100,
      y: Math.round(at.y * 100) / 100,
      heading: 0,
      text: text.trim(),
      logMs,
    },
  };
}

/** A new name for an area: its section on a shelf or a counter, else its label. */
export function renamedArea(area: MapArea, name: string): MapArea {
  const text = name.trim();
  const { section: _section, label: _label, ...rest } = area;
  if (takesSection(area.kind)) {
    return {
      ...rest,
      ...(area.label !== undefined ? { label: area.label } : {}),
      ...(text !== '' ? { section: text } : {}),
    };
  }
  return {
    ...rest,
    ...(area.section !== undefined ? { section: area.section } : {}),
    ...(text !== '' ? { label: text } : {}),
  };
}

/** The name an area goes by: its section, else its label, else nothing. */
export function areaName(area: MapArea): string | null {
  const name = (area.section ?? area.label ?? '').trim();
  return name === '' ? null : name;
}

/** The key of an area's kind as the sheet names it: a shelf with a section is a Section. */
export function areaKindKey(area: MapArea): string {
  return area.kind === 'shelf' && area.section !== undefined
    ? 'shopMapEdit.kind.section'
    : `shopMapEdit.kind.${area.kind}`;
}

/** A size in metres the way the locale writes numbers: `2.8` or `2,8`. */
export function metresText(value: number, locale: string): string {
  const rounded = Math.round(value * 100) / 100;
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
      rounded
    );
  } catch {
    return String(rounded);
  }
}

/** Fold edits onto a map, as the server will. */
export function applyEdits(
  document: ShopMapDocumentV2,
  events: readonly WalkEvent[],
  logMs: number
): ShopMapDocumentV2 {
  return foldWalk(
    [
      {
        id: 'local',
        seq: 1,
        kind: 'edited',
        at: new Date(0).toISOString(),
        logFrom: logMs,
        logTo: logMs,
        events: [...events],
      },
    ],
    document
  );
}

/** Whether edits leave the map valid. The canvas refuses its own; this is for the menu's. */
export function editsAllowed(
  document: ShopMapDocumentV2,
  events: readonly WalkEvent[],
  logMs: number
): boolean {
  return validateShopMapV2(applyEdits(document, events, logMs)).length === 0;
}

/** The colours an area can be given, Default first (the `EditArea` board). */
export const AREA_COLOURS = [
  { key: 'paleBlue', value: '#c9e6f5' },
  { key: 'green', value: '#d6ecd9' },
  { key: 'orange', value: '#f6d9c8' },
  { key: 'lilac', value: '#e4dbf5' },
  { key: 'yellow', value: '#f7e9a8' },
] as const;

/** The same colour both ways, for comparing a stored one with the palette. */
export function sameColour(a: AreaColour, b: AreaColour): boolean {
  if (a.mode !== b.mode) {
    return false;
  }
  return (
    a.mode !== 'custom' ||
    a.value.toLowerCase() === (b as typeof a).value.toLowerCase()
  );
}

/** How a swatch of an area's colour is drawn, in the canvas's own colours. */
export interface SwatchStyle {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

/**
 * A swatch as the canvas draws the area: a custom colour is its fill with a
 * border 40 percent darker, and the default is the kind's own colour in the
 * theme on screen (editor plan 0001, section 2).
 */
export function swatchStyle(
  colour: AreaColour,
  kind: AreaKind,
  theme: AppTheme
): SwatchStyle {
  const side = theme === 'night' ? 1 : 0;
  if (colour.mode === 'custom') {
    return {
      background: colour.value,
      border: darken(colour.value, 0.4),
      text: darken(colour.value, 0.7),
    };
  }
  const p = SHOP_MAP_PROPERTIES;
  switch (kind) {
    case 'counter':
      return {
        background: p.counter[side],
        border: p['counter-border'][side],
        text: p['counter-text'][side],
      };
    case 'blocked':
      return {
        background: p.blocked[side],
        border: p.blocked[side],
        text: p['pin-ink'][side],
      };
    case 'path':
    case 'entrance':
      return {
        background: p.walked[side],
        border: p['area-border'][side],
        text: p['area-text'][side],
      };
    case 'checkout':
      return {
        background: p.checkout[side],
        border: p['checkout-border'][side],
        text: p['area-text'][side],
      };
    default:
      return {
        background: p.area[side],
        border: p['area-border'][side],
        text: p['area-text'][side],
      };
  }
}

/** The swatch of a kind itself, for the menu's kind actions. */
export function kindSwatch(
  action: HoldKindAction,
  theme: AppTheme
): SwatchStyle {
  return swatchStyle({ mode: 'default' }, KIND_OF[action], theme);
}

function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    return hex;
  }
  const n = parseInt(m[1], 16);
  const channel = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * What the area sheet needs from the page it covers (velista `0123`, target 3).
 * The edit page provides it, and so will the recording screen of velista `0126`,
 * so the sheet knows nothing of either page.
 */
export interface MapEditSession {
  /** The map as edited so far. Null while the walk is read. */
  readonly document: Signal<ShopMapDocumentV2 | null>;
  /** Apply edits to the map on screen and to what is saved. False when refused. */
  apply(events: readonly WalkEvent[]): boolean;
  /** Whether the area was drawn on this page, which ticks its category colour box. */
  isNew(areaId: string): boolean;
  /** Select an area on the canvas, or clear the selection. */
  select(areaId: string | null): void;
  /** The page the sheet covers, for dismissing it on a cold load. */
  pageUrl(): string;
}

export const MAP_EDIT_SESSION = new InjectionToken<MapEditSession>(
  'MAP_EDIT_SESSION'
);
