import {
  CdkConnectedOverlay,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { resolve } from 'node:path';
import { compile } from 'sass';
import {
  AnchoredPopover,
  type AnchoredPopoverAlign,
  type AnchoredPopoverFrame,
  type AnchoredPopoverSide,
} from './anchored-popover';

/**
 * Where an anchored popover tries to sit. The overlay takes the first place of the
 * list that fits, so the order of the list is the side it prefers.
 *
 * The places are read off the CDK directive, which is what the component hands
 * them to. Nothing is opened here.
 */
let anchor: HTMLButtonElement;

async function render(inputs: {
  readonly align?: AnchoredPopoverAlign;
  readonly side?: AnchoredPopoverSide;
  readonly frame?: AnchoredPopoverFrame;
}): Promise<ComponentFixture<AnchoredPopover>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AnchoredPopover],
  }).compileComponents();

  anchor = document.createElement('button');
  document.body.append(anchor);

  const fixture = TestBed.createComponent(AnchoredPopover);
  fixture.componentRef.setInput('origin', anchor);
  if (inputs.align !== undefined) {
    fixture.componentRef.setInput('align', inputs.align);
  }
  if (inputs.side !== undefined) {
    fixture.componentRef.setInput('side', inputs.side);
  }
  if (inputs.frame !== undefined) {
    fixture.componentRef.setInput('frame', inputs.frame);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function overlayOf(fixture: ComponentFixture<unknown>): CdkConnectedOverlay {
  return fixture.debugElement
    .queryAllNodes(By.directive(CdkConnectedOverlay))[0]
    .injector.get(CdkConnectedOverlay);
}

function positions(
  fixture: ComponentFixture<AnchoredPopover>
): ConnectedPosition[] {
  const node = fixture.debugElement.queryAllNodes(
    By.directive(CdkConnectedOverlay)
  )[0];
  return node?.injector.get(CdkConnectedOverlay).positions ?? [];
}

/** Which side of the anchor each place is on, in the order they are tried. */
function sides(fixture: ComponentFixture<AnchoredPopover>): string[] {
  return positions(fixture).map((place) =>
    place.originY === 'top' && place.overlayY === 'bottom' ? 'above' : 'below'
  );
}

afterEach(() => {
  anchor?.remove();
});

describe('AnchoredPopover', () => {
  it('tries above the anchor first unless told otherwise', async () => {
    const fixture = await render({});

    expect(sides(fixture)).toEqual(['above', 'below']);
  });

  it('tries below the anchor first when asked, and keeps above as the second place', async () => {
    const fixture = await render({ side: 'below' });

    expect(sides(fixture)).toEqual(['below', 'above']);
  });

  it('holds the same two places on either side, in the other order', async () => {
    const above = positions(await render({ side: 'above' }));
    const below = positions(await render({ side: 'below' }));

    expect(below).toEqual([...above].reverse());
  });

  it('keeps the edge it lines up with when the side changes', async () => {
    const start = await render({ side: 'below' });
    expect(positions(start).map((place) => place.originX)).toEqual([
      'start',
      'start',
    ]);

    const end = await render({ align: 'end', side: 'below' });
    expect(sides(end)).toEqual(['below', 'above']);
    expect(positions(end).map((place) => place.originX)).toEqual([
      'end',
      'end',
    ]);
    expect(positions(end).map((place) => place.overlayX)).toEqual([
      'end',
      'end',
    ]);
  });

  it('pushes the popover away from the anchor on each side', async () => {
    const fixture = await render({ side: 'below' });

    // Below is a gap under the anchor, and above is a gap over it.
    expect(positions(fixture).map((place) => place.offsetY)).toEqual([8, -8]);
  });

  it('lines up with the anchor’s middle when asked, above first (velista 0188)', async () => {
    const fixture = await render({ align: 'center' });

    expect(sides(fixture)).toEqual(['above', 'below']);
    expect(positions(fixture).map((place) => place.originX)).toEqual([
      'center',
      'center',
    ]);
    expect(positions(fixture).map((place) => place.overlayX)).toEqual([
      'center',
      'center',
    ]);
  });

  it('pushes back onto the screen only when asked (velista 0188)', async () => {
    const plain = await render({});
    expect(overlayOf(plain).push).toBe(false);

    const pushed = await render({});
    pushed.componentRef.setInput('push', true);
    pushed.detectChanges();
    expect(overlayOf(pushed).push).toBe(true);
    expect(overlayOf(pushed).viewportMargin).toBe(16);
  });

  it('gives the side that was asked for after it changes', async () => {
    const fixture = await render({});

    fixture.componentRef.setInput('side', 'below');
    fixture.detectChanges();

    expect(sides(fixture)).toEqual(['below', 'above']);
  });
});

/**
 * The places of `dev` before velista `0206`, written out, so a popover that does
 * not ask for a pointer is held to them literally.
 */
const DEV_PLACES: Record<AnchoredPopoverAlign, ConnectedPosition[]> = {
  start: [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetX: 12,
      offsetY: -8,
    },
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetX: 12,
      offsetY: 8,
    },
  ],
  end: [
    {
      originX: 'end',
      originY: 'top',
      overlayX: 'end',
      overlayY: 'bottom',
      offsetY: -8,
    },
    {
      originX: 'end',
      originY: 'bottom',
      overlayX: 'end',
      overlayY: 'top',
      offsetY: 8,
    },
  ],
  center: [
    {
      originX: 'center',
      originY: 'top',
      overlayX: 'center',
      overlayY: 'bottom',
      offsetY: -8,
    },
    {
      originX: 'center',
      originY: 'bottom',
      overlayX: 'center',
      overlayY: 'top',
      offsetY: 8,
    },
  ],
};

const FRAMES: AnchoredPopoverFrame[] = ['note', 'choice', 'hint'];
const ALIGNS: AnchoredPopoverAlign[] = ['start', 'center', 'end'];
const SIDES: AnchoredPopoverSide[] = ['above', 'below'];

/**
 * An open popover in a 390 by 844 screen, with a row that holds its anchor
 * (velista `0206`).
 *
 * jsdom lays nothing out, so the boxes are given: the row and the anchor are
 * placed by each spec, and the popover's box is read back from the styles the
 * overlay wrote on its pane, which is where the overlay put it. The pointer's box
 * is worked out from the board's numbers in `anchored-popover.scss`.
 */
const SCREEN = { width: 390, height: 844 };
const POP = { width: 276, height: 140 };

/** The board's pointer: a 12 px square turned 45 degrees, 7 px outside the padding edge. */
const POINTER_SIZE = 12;
const POINTER_OUTSET = 7;
const HAIRLINE = 1;

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

let rects: Map<Element, Rect>;
let popSize: { width: number; height: number };

function domRect(rect: Rect): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  } as DOMRect;
}

/** Where the overlay put the pane: its exact styles, then its offset transform. */
function paneRect(pane: HTMLElement): Rect {
  const style = pane.style;
  const { width, height } = popSize;
  let top = 0;
  if (style.top) {
    top = parseFloat(style.top);
  } else if (style.bottom) {
    top = SCREEN.height - parseFloat(style.bottom) - height;
  }
  let left = 0;
  if (style.left) {
    left = parseFloat(style.left);
  } else if (style.right) {
    left = SCREEN.width - parseFloat(style.right) - width;
  }
  const x = /translateX\((-?[\d.]+)px\)/.exec(style.transform);
  const y = /translateY\((-?[\d.]+)px\)/.exec(style.transform);
  return {
    left: left + (x ? parseFloat(x[1]) : 0),
    top: top + (y ? parseFloat(y[1]) : 0),
    width,
    height,
  };
}

@Component({
  imports: [AnchoredPopover],
  template: `
    <lib-anchored-popover
      [accent]="accent()"
      [align]="align()"
      [frame]="frame()"
      [keepInSight]="keepInSight()"
      [open]="open()"
      [origin]="origin"
      [pointer]="pointer()"
      [push]="push()"
      [side]="side()"
    >
      <p class="said">One sentence.</p>
      <button class="answer" type="button">An answer</button>
    </lib-anchored-popover>
  `,
})
class Host {
  origin!: HTMLElement;
  readonly open = signal(false);
  readonly pointer = signal(false);
  readonly accent = signal(false);
  readonly push = signal(false);
  readonly keepInSight = signal<Element | null>(null);
  readonly align = signal<AnchoredPopoverAlign>('start');
  readonly side = signal<AnchoredPopoverSide>('above');
  readonly frame = signal<AnchoredPopoverFrame>('note');
}

let row: HTMLDivElement;
let control: HTMLButtonElement;

async function openHost(inputs: {
  readonly pointer?: boolean;
  readonly keepInSight?: boolean;
  readonly align?: AnchoredPopoverAlign;
  readonly side?: AnchoredPopoverSide;
  readonly frame?: AnchoredPopoverFrame;
  readonly accent?: boolean;
  readonly row?: Rect;
  readonly control?: Rect;
}): Promise<ComponentFixture<Host>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

  row?.remove();
  row = document.createElement('div');
  control = document.createElement('button');
  row.append(control);
  document.body.append(row);
  rects.set(row, inputs.row ?? { left: 16, top: 400, width: 358, height: 64 });
  rects.set(
    control,
    inputs.control ?? { left: 28, top: 412, width: 112, height: 40 }
  );

  const fixture = TestBed.createComponent(Host);
  const host = fixture.componentInstance;
  host.origin = control;
  host.pointer.set(inputs.pointer ?? false);
  host.keepInSight.set(inputs.keepInSight ? row : null);
  host.align.set(inputs.align ?? 'start');
  host.side.set(inputs.side ?? 'above');
  host.frame.set(inputs.frame ?? 'note');
  host.accent.set(inputs.accent ?? false);
  fixture.detectChanges();
  host.open.set(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function pop(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.pop');
  if (!found) {
    throw new Error('the popover is not open');
  }
  return found;
}

function pointer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.ptr');
}

function popBox(): Rect {
  return (
    rects.get(pop()) ??
    paneRect(pop().closest('.cdk-overlay-pane') as HTMLElement)
  );
}

/**
 * The pointer's box on the screen: the square's centre stands on the edge it
 * faces (the padding edge less the outset less half the square), and turned 45
 * degrees it reaches half its diagonal around that centre.
 */
function pointerBox(): Rect {
  const mark = pointer();
  if (!mark) {
    throw new Error('no pointer');
  }
  const box = popBox();
  const half = POINTER_SIZE / 2;
  const reach = half * Math.SQRT2;
  const centreX =
    box.left + pop().clientLeft + parseFloat(mark.style.left) + half;
  const centreY = mark.classList.contains('up')
    ? box.top + box.height - HAIRLINE + POINTER_OUTSET - half
    : box.top + HAIRLINE - POINTER_OUTSET + half;
  return {
    left: centreX - reach,
    top: centreY - reach,
    width: 2 * reach,
    height: 2 * reach,
  };
}

function pointerCentreX(): number {
  const box = pointerBox();
  return box.left + box.width / 2;
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** Whether the popover sits above the row and the control, by its box. */
function isAbove(): boolean {
  const box = popBox();
  return box.top + box.height <= (rects.get(row)?.top ?? 0);
}

describe('AnchoredPopover pointer (velista 0206)', () => {
  let restore: (() => void)[] = [];
  // The spec runner hands components no styles, so the component's own stylesheet
  // is compiled and put in the document, and jsdom cascades it.
  let sheet: HTMLStyleElement;
  let css = '';

  beforeAll(() => {
    css = compile(resolve(__dirname, 'anchored-popover.scss')).css;
    sheet = document.createElement('style');
    sheet.textContent = css;
    document.head.append(sheet);
  });

  afterAll(() => {
    sheet.remove();
  });

  /**
   * The declarations of every rule that matches an element, in the order of the
   * stylesheet, as written: jsdom drops a shorthand that holds a var(), so a
   * hairline is read here and not off the computed style.
   */
  function declared(element: Element): string {
    const found: string[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      let matches = false;
      try {
        matches = element.matches(selector.trim());
      } catch {
        matches = false;
      }
      if (matches) {
        found.push(body.trim());
      }
    }
    return found.join('\n');
  }

  beforeEach(() => {
    rects = new Map();
    popSize = { ...POP };
    const define = (target: object, key: string, value: number): void => {
      const before = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, {
        configurable: true,
        get: () => value,
      });
      restore.push(() => {
        if (before) {
          Object.defineProperty(target, key, before);
        } else {
          delete (target as Record<string, unknown>)[key];
        }
      });
    };
    define(window, 'innerWidth', SCREEN.width);
    define(window, 'innerHeight', SCREEN.height);
    define(document.documentElement, 'clientWidth', SCREEN.width);
    define(document.documentElement, 'clientHeight', SCREEN.height);

    const rectSpy = jest
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const given = rects.get(this);
        if (given) {
          return domRect(given);
        }
        const pane = this.closest('.cdk-overlay-pane');
        if (
          pane instanceof HTMLElement &&
          (this === pane || this.classList.contains('pop'))
        ) {
          return domRect(paneRect(pane));
        }
        return domRect({ left: 0, top: 0, width: 0, height: 0 });
      });
    const widthSpy = jest
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('ptr') ? POINTER_SIZE : 0;
      });
    restore.push(
      () => rectSpy.mockRestore(),
      () => widthSpy.mockRestore()
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    row?.remove();
    for (const undo of restore.reverse()) {
      undo();
    }
    restore = [];
  });

  describe('without a pointer, it is the popover of dev', () => {
    for (const align of ALIGNS) {
      for (const side of SIDES) {
        for (const frame of FRAMES) {
          it(`holds the places of dev, ${frame}, ${align}, ${side}`, async () => {
            const fixture = await render({ align, side, frame });

            const expected =
              side === 'below'
                ? [...DEV_PLACES[align]].reverse()
                : DEV_PLACES[align];
            expect(positions(fixture)).toEqual(expected);
            expect(overlayOf(fixture).push).toBe(false);
            expect(overlayOf(fixture).viewportMargin).toBe(0);
            expect(overlayOf(fixture).origin).toBe(anchor);
          });
        }
      }
    }

    for (const frame of FRAMES) {
      it(`draws the DOM and the classes of dev, ${frame}`, async () => {
        await openHost({ frame });

        const element = pop();
        const classes = [...element.classList].sort();
        expect(classes).toEqual(
          frame === 'note' ? ['pop'] : ['pop', frame].sort()
        );
        // The pane holds the popover alone, and the popover holds what the
        // container put in it, directly.
        const pane = element.closest('.cdk-overlay-pane');
        expect([...(pane?.children ?? [])]).toEqual([element]);
        expect([...element.children].map((child) => child.className)).toEqual([
          'said',
          'answer',
        ]);
        expect(pointer()).toBeNull();
        expect(document.querySelector('.clip')).toBeNull();
      });
    }

    it('keeps the clip of the choice frame on the frame itself', async () => {
      await openHost({ frame: 'choice' });

      const style = getComputedStyle(pop());
      // The frame of dev, property by property.
      expect({
        overflow: style.overflow,
        padding: style.padding,
        gap: style.gap,
        inlineSize: style.inlineSize,
        borderRadius: style.borderRadius,
        background: style.background,
        boxShadow: style.boxShadow,
        position: style.position,
      }).toEqual({
        overflow: 'hidden',
        padding: 'var(--app-space-3) 0 var(--app-space-2)',
        gap: '0',
        inlineSize: 'var(--app-add-choice-width)',
        borderRadius: 'var(--app-radius-md)',
        background: 'var(--app-surface-raised)',
        boxShadow: 'var(--app-elevation-2)',
        position: '',
      });
      // jsdom cannot spread a border shorthand that holds a var(), so the hairline
      // is read off the rules.
      expect(declared(pop())).toContain(
        'border: 1px solid var(--app-border-subtle)'
      );
      expect(declared(pop())).not.toContain('--anchored-popover-accent');
    });

    it('ignores the element to keep in sight', async () => {
      const fixture = await openHost({ keepInSight: true, align: 'end' });

      expect(overlayOf(fixture).origin).toBe(control);
      expect(overlayOf(fixture).positions).toEqual(DEV_PLACES.end);
    });
  });

  it('draws the pointer on the bottom edge above, and on the top edge below', async () => {
    await openHost({ pointer: true, keepInSight: true });
    expect(isAbove()).toBe(true);
    expect(pointer()?.classList.contains('up')).toBe(true);
    expect(pointer()?.classList.contains('down')).toBe(false);

    await openHost({ pointer: true, keepInSight: true, side: 'below' });
    expect(isAbove()).toBe(false);
    expect(pointer()?.classList.contains('down')).toBe(true);
    expect(pointer()?.classList.contains('up')).toBe(false);
  });

  it('is never pushed, and keeps off the screen’s edges', async () => {
    const fixture = await openHost({ pointer: true });
    fixture.componentInstance.push.set(true);
    fixture.detectChanges();

    expect(overlayOf(fixture).push).toBe(false);
    expect(overlayOf(fixture).viewportMargin).toBe(16);
  });

  const PLACES: [string, AnchoredPopoverAlign, Rect][] = [
    ['the start', 'start', { left: 28, top: 412, width: 112, height: 40 }],
    ['the middle', 'center', { left: 139, top: 412, width: 112, height: 40 }],
    ['the end', 'end', { left: 250, top: 412, width: 112, height: 40 }],
  ];

  for (const [where, align, place] of PLACES) {
    it(`centres the pointer on an anchor at ${where} of the screen`, async () => {
      await openHost({
        pointer: true,
        keepInSight: true,
        align,
        control: place,
      });

      const centre = place.left + place.width / 2;
      expect(Math.abs(pointerCentreX() - centre)).toBeLessThanOrEqual(1);
    });

    it(`centres the pointer with no row named, at ${where}`, async () => {
      await openHost({ pointer: true, align, control: place });

      const centre = place.left + place.width / 2;
      expect(Math.abs(pointerCentreX() - centre)).toBeLessThanOrEqual(1);
    });
  }

  it('holds the pointer to the straight part of the edge', async () => {
    // A narrow control at the very start, with the popover lined up past it.
    await openHost({
      pointer: true,
      control: { left: 0, top: 412, width: 4, height: 40 },
    });

    const box = popBox();
    expect(pointerCentreX()).toBeGreaterThanOrEqual(
      box.left + POINTER_SIZE / 2
    );
  });

  for (const side of SIDES) {
    it(`covers neither the row nor the control, asked ${side}`, async () => {
      await openHost({ pointer: true, keepInSight: true, side });

      expect(isAbove()).toBe(side === 'above');
      for (const kept of [rects.get(row), rects.get(control)]) {
        expect(intersects(popBox(), kept as Rect)).toBe(false);
        expect(intersects(pointerBox(), kept as Rect)).toBe(false);
      }
      // The tip lands 3 to 4 px off the row.
      const kept = rects.get(row) as Rect;
      const tip = pointerBox();
      const gap =
        side === 'above'
          ? kept.top - (tip.top + tip.height)
          : tip.top - (kept.top + kept.height);
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(4);
    });
  }

  it('lines its end up with the row’s end when asked for the end', async () => {
    await openHost({ pointer: true, keepInSight: true, align: 'end' });

    const box = popBox();
    const kept = rects.get(row) as Rect;
    expect(box.left + box.width).toBe(kept.left + kept.width);
  });

  it('flips below when there is no room above, with the pointer on the top edge', async () => {
    await openHost({
      pointer: true,
      keepInSight: true,
      row: { left: 16, top: 60, width: 358, height: 64 },
      control: { left: 28, top: 72, width: 112, height: 40 },
    });

    expect(isAbove()).toBe(false);
    expect(pointer()?.classList.contains('down')).toBe(true);
    expect(intersects(popBox(), rects.get(row) as Rect)).toBe(false);
  });

  it('opens on the side with more room when neither fits, still off the row', async () => {
    popSize = { width: POP.width, height: 400 };
    await openHost({
      pointer: true,
      keepInSight: true,
      row: { left: 16, top: 300, width: 358, height: 200 },
      control: { left: 28, top: 380, width: 112, height: 40 },
    });

    // Above has 272 px of room and below 316, so it opens below though it asked above.
    expect(isAbove()).toBe(false);
    expect(pointer()?.classList.contains('down')).toBe(true);
    expect(intersects(popBox(), rects.get(row) as Rect)).toBe(false);
    expect(intersects(pointerBox(), rects.get(row) as Rect)).toBe(false);
  });

  it('draws the pointer of the choice frame outside anything that clips', async () => {
    await openHost({ pointer: true, keepInSight: true, frame: 'choice' });

    const mark = pointer() as HTMLElement;
    const clip = document.querySelector('.clip') as HTMLElement;
    // The clip moved inside, around the content and not around the pointer.
    expect(getComputedStyle(clip).overflow).toBe('hidden');
    expect(clip.contains(mark)).toBe(false);
    expect([...clip.children].map((child) => child.className)).toEqual([
      'said',
      'answer',
    ]);

    const pane = pop().closest('.cdk-overlay-pane');
    for (
      let element = mark.parentElement;
      element && element !== pane;
      element = element.parentElement
    ) {
      expect(getComputedStyle(element).overflow).not.toBe('hidden');
    }
  });

  it('colours the hairlines from the caller’s accent, and no fill', async () => {
    await openHost({ pointer: true, keepInSight: true, accent: true });

    expect(pop().classList.contains('accent')).toBe(true);
    const mark = pointer() as HTMLElement;
    for (const element of [pop(), mark]) {
      // The accent rule is the last to set the hairline's colour, so it wins.
      const rules = declared(element);
      expect(rules).toContain('border-color: var(--anchored-popover-accent)');
      expect(rules.lastIndexOf('--anchored-popover-accent')).toBeGreaterThan(
        rules.lastIndexOf('var(--app-border-subtle)')
      );
      expect(getComputedStyle(element).background).toBe(
        'var(--app-surface-raised)'
      );
    }
  });

  it('draws the hairlines in the border token when there is no accent', async () => {
    await openHost({ pointer: true, keepInSight: true });

    expect(declared(pop())).toContain(
      'border: 1px solid var(--app-border-subtle)'
    );
    const rules = declared(pointer() as HTMLElement);
    expect(rules).toContain('border-right: 1px solid var(--app-border-subtle)');
    expect(rules).toContain(
      'border-bottom: 1px solid var(--app-border-subtle)'
    );
    expect(rules).not.toContain('--anchored-popover-accent');
    expect(rules).not.toContain('box-shadow');
    expect(rules).not.toContain('animation');
  });
});
