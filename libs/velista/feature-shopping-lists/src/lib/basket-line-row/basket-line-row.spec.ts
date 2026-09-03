import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  LINE_QUANTITY_MAX,
  QUANTITY_REEL_IDLE_MS,
  type BasketLine,
  type BasketParticipant,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { BasketLineRow } from './basket-line-row';

/**
 * The row's status control (plan 0052, section 6).
 *
 * What this is really asserting is that the control **says what pressing it does**,
 * differently for each of the four states, and that the row's own button is still the
 * control it always was with the composed label it always had. A row that grew a
 * second button and lost the first would pass a test that only counted glyphs.
 *
 * Assertions are on `aria-label` keys rather than on rendered English, because the
 * testing translator echoes keys: the question is which sentence was chosen and what
 * it was given, never how it reads after a copy edit.
 */

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    content: 'Milk',
    quantity: 3,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: null,
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...overrides,
  };
}

/** A finished line, which is the pair of states the report is really about. */
const bought = () =>
  line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'BOUGHT' });
const unavailable = () =>
  line({ settled: 3, touchedBy: 'p-1', lastOutcome: 'NOT_AVAILABLE' });

async function render(
  row: BasketLine,
  options: {
    canReopen?: boolean;
    people?: ReadonlyMap<string, BasketParticipant>;
    listNames?: ReadonlyMap<string, string>;
    busy?: boolean;
    notice?: { key: string; count: number } | null;
    /** Whether the **trip** is over, which is not the same as a finished line. */
    finished?: boolean;
  } = {}
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketLineRow, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketLineRow);
  fixture.componentRef.setInput('line', row);
  fixture.componentRef.setInput(
    'people',
    options.people ?? new Map<string, BasketParticipant>()
  );
  fixture.componentRef.setInput('products', new Map());
  fixture.componentRef.setInput('listNames', options.listNames ?? new Map());
  fixture.componentRef.setInput('canReopen', options.canReopen ?? false);
  fixture.componentRef.setInput('busy', options.busy ?? false);
  fixture.componentRef.setInput('notice', options.notice ?? null);
  fixture.componentRef.setInput('finished', options.finished ?? false);
  fixture.detectChanges();

  return fixture;
}

/** One participant, enough to be named. */
function person(id: string, displayName: string): BasketParticipant {
  return {
    id,
    kind: 'GUEST',
    displayName,
    username: null,
    guestNumber: 1,
    userId: null,
    joinedAt: null,
    lastSeenAt: null,
    shareLinkId: 'link-1',
  };
}

const status = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).querySelector('.status');

const body = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).querySelector('.body');

const reel = (fixture: Awaited<ReturnType<typeof render>>) =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'lib-quantity-reel'
  ) as HTMLElement;

const text = (fixture: Awaited<ReturnType<typeof render>>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent ??
  '';

/**
 * The keyboard half of the reel, which is a real path and the one a spec can drive.
 *
 * jsdom has no `PointerEvent`, so the drag is stood in for by the keys the same
 * control answers: they move the same pending value, they commit on the same idle
 * beat, and section 7 requires them to work anyway.
 */
function key(fixture: Awaited<ReturnType<typeof render>>, name: string): void {
  reel(fixture).dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true })
  );
  fixture.detectChanges();
}

/** Let go: the overlay waits out its idle beat, and the close is the commit. */
function letGo(fixture: Awaited<ReturnType<typeof render>>): void {
  jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
  fixture.detectChanges();
}

describe('BasketLineRow: the status control', () => {
  it('offers to get the whole thing on a line nobody has touched', async () => {
    const fixture = await render(line());

    const control = status(fixture);
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.getAttribute('aria-label')).toContain('basket.status.got');
  });

  it('offers the rest on a line somebody got some of', async () => {
    // A different sentence, because a person who has already got two of three is not
    // being asked the same question as somebody starting the line.
    const fixture = await render(line({ settled: 1 }));

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.rest'
    );
  });

  it('offers to undo a purchase on a finished line', async () => {
    const fixture = await render(bought(), { canReopen: true });

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.undoGot'
    );
  });

  it('does not call a shop that had none a purchase', async () => {
    // The reason the fourth state exists at all. `NOT_AVAILABLE` closes the
    // outstanding amount exactly as a purchase does, so these two lines have
    // identical numbers, and a tick on this one would claim a purchase that never
    // happened.
    const fixture = await render(unavailable(), { canReopen: true });

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.undoNone'
    );
  });

  it('draws a different shape for each of the four states', async () => {
    // Never colour alone (`0044`, section 7). The shape is what survives a bright
    // aisle and a reader who does not distinguish the hues.
    const glyphs = await Promise.all(
      [line(), line({ settled: 1 }), bought(), unavailable()].map(
        async (row) => {
          const fixture = await render(row, { canReopen: true });
          return status(fixture)?.firstElementChild?.tagName ?? '';
        }
      )
    );

    expect(new Set(glyphs).size).toBe(4);
    expect(glyphs).not.toContain('');
  });
});

describe('BasketLineRow: what a tap does', () => {
  it('asks for the whole outstanding amount, and never opens the sheet', async () => {
    // One tap is the whole point: settling everything used to cost a tap, a sheet, a
    // tap and a dismissal.
    const fixture = await render(line());
    const settled: unknown[] = [];
    const opened: unknown[] = [];
    fixture.componentInstance.settle.subscribe(() => settled.push(1));
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    (status(fixture) as HTMLButtonElement).click();

    expect(settled).toHaveLength(1);
    expect(opened).toHaveLength(0);
  });

  it('reopens a finished line rather than settling it again', async () => {
    const fixture = await render(bought(), { canReopen: true });
    const reopened: unknown[] = [];
    const settled: unknown[] = [];
    fixture.componentInstance.reopen.subscribe(() => reopened.push(1));
    fixture.componentInstance.settle.subscribe(() => settled.push(1));

    (status(fixture) as HTMLButtonElement).click();

    expect(reopened).toHaveLength(1);
    expect(settled).toHaveLength(0);
  });
});

describe('BasketLineRow: a backend with no reopen route', () => {
  it('states what a finished line is instead of offering an act that would 404', async () => {
    // Plan 0052, section 10. A control you may not use is not drawn (`0030`), so this
    // is a mark and not a disabled button: nothing has been taken away from this
    // reader, and a dimmed control would say something about them that is not true.
    const fixture = await render(bought(), { canReopen: false });

    const control = status(fixture);
    expect(control?.tagName).toBe('SPAN');
    expect(control?.getAttribute('aria-label')).toContain(
      'basket.status.isGot'
    );
  });

  it('still lets an unfinished line be settled in one tap', async () => {
    // The settle direction works in full from the first commit, and it is most of the
    // value: only the reopen half waits on luna `0054`.
    const fixture = await render(line(), { canReopen: false });

    expect(status(fixture)?.tagName).toBe('BUTTON');
  });
});

/**
 * A row on a trip that is over (velista `0057`, section 6).
 *
 * The row still **says** everything it said: the words, the product, who settled it,
 * which household it came from. What goes is everything that would change it, absent
 * rather than disabled, because every one of those writes is refused by the server on
 * a finished basket and a drawn control is an invitation that cannot be honoured.
 */
describe('BasketLineRow: the trip is finished', () => {
  it('draws no settle control, even on a line nobody settled', async () => {
    // The case a line-level check would miss entirely: this line has everything
    // outstanding, so `canReopen` and the line's own state both say "offer the
    // control", and the basket says no.
    const fixture = await render(line(), { finished: true, canReopen: true });

    const control = status(fixture);
    expect(control?.tagName).toBe('SPAN');
    expect(control?.getAttribute('aria-label')).toContain(
      'basket.status.isWanted'
    );
  });

  it('says what a partly settled line is rather than offering the rest', async () => {
    const fixture = await render(line({ settled: 1 }), { finished: true });

    expect(status(fixture)?.getAttribute('aria-label')).toContain(
      'basket.status.isPartly'
    );
  });

  it('offers no undo on a line somebody did settle', async () => {
    const fixture = await render(bought(), { finished: true, canReopen: true });

    const control = status(fixture);
    expect(control?.tagName).toBe('SPAN');
    expect(control?.getAttribute('aria-label')).toContain(
      'basket.status.isGot'
    );
  });

  it('turns the reel back into the number it was before plan 0054', async () => {
    const fixture = await render(line({ quantity: 3, settled: 1 }), {
      finished: true,
    });

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('lib-quantity-reel')
    ).toBeNull();
    expect(text(fixture, '.settled-count').trim()).toBe('2');
  });

  it('still opens the sheet, which is where the history is', async () => {
    // A finished basket is the receipt for a trip somebody took, and the most likely
    // reason to open one is to see what was bought.
    const fixture = await render(bought(), { finished: true });

    expect(body(fixture)?.tagName).toBe('BUTTON');
  });
});

describe('BasketLineRow: the row itself', () => {
  it('still opens the sheet, and still carries the whole line in its name', async () => {
    // `0044`'s composed label is not a casualty of the split: the quantity and the
    // attribution are separate lines visually, and a reader moving by button would
    // otherwise hear only the content.
    const fixture = await render(line({ quantity: 3 }));
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    const control = body(fixture) as HTMLButtonElement;
    control.click();

    expect(opened).toHaveLength(1);
    const label = control.getAttribute('aria-label') ?? '';
    expect(label).toContain('Milk');
    expect(label).toContain('basket.line.wanted');
  });

  /**
   * Plan 0053, section 5: a line somebody typed in an aisle.
   *
   * It is an ordinary row with two things absent and one added, and none of the
   * three needs a flag: the data decides, which is the same rule the "from" caption
   * has followed since `0044` section 4.1.
   */
  describe('a line added in the shop', () => {
    it('names who added it', async () => {
      const fixture = await render(line({ createdBy: 'p-1' }), {
        people: new Map([['p-1', person('p-1', 'Dani')]]),
      });

      expect(
        (fixture.nativeElement as HTMLElement).textContent ?? ''
      ).toContain('basket.added.by');
    });

    it('shows no list name, for a reader who would otherwise see one', async () => {
      // `origins` present and **empty** is the case: this reader passes the rule and
      // the line genuinely came from nowhere. Nothing in the row says so; the
      // caption simply has nothing to draw, which is the whole design.
      const fixture = await render(line({ createdBy: 'p-1', origins: [] }), {
        people: new Map([['p-1', person('p-1', 'Dani')]]),
        listNames: new Map([['list-weekly', 'Weekly shop']]),
      });

      const html = fixture.nativeElement as HTMLElement;
      expect(html.querySelector('.from')).toBeNull();
      expect(html.textContent ?? '').not.toContain('Weekly shop');
    });
  });

  it('is a container rather than a control, so it may hold two buttons', async () => {
    // A button cannot contain a button, which is what splits the row in the first
    // place. The row keeping its own `button` role would be an invalid tree that
    // renders anyway and announces wrongly.
    const fixture = await render(line());

    const row = (fixture.nativeElement as HTMLElement).querySelector('.row');
    expect(row?.tagName).toBe('DIV');
    expect(row?.querySelectorAll('button')).toHaveLength(2);
  });
});

/**
 * The number on the row is the control (plan 0054).
 *
 * Two things are asserted here and neither of them is the reel, which has its own
 * spec. The first is the **sentence**: down and up are different acts, and the row
 * has to say which one is about to happen while the thumb is still down, because
 * that caption is the confirmation and there is deliberately no dialog behind it.
 * The second is that the row still opens the sheet on a tap while never opening it
 * on a gesture, which is the arrangement the whole control rests on.
 */
describe('BasketLineRow: the number as a control', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('names what is still to get, not how many to buy', async () => {
    // Section 7. The reel is bound to the outstanding amount, so that is what its
    // name says; "how many to buy" is the number underneath it.
    const fixture = await render(line({ quantity: 5 }));

    expect(reel(fixture).getAttribute('aria-label')).toContain(
      'basket.outstanding.label'
    );
    expect(reel(fixture).getAttribute('aria-valuenow')).toBe('5');
  });

  it('leaves the reel out of the name on the row body', async () => {
    // Section 7 again: the body keeps the full composed name it always had, and the
    // reel is excluded from it rather than repeated inside it.
    const fixture = await render(line({ quantity: 5 }));

    expect(body(fixture)?.getAttribute('aria-label')).not.toContain(
      'basket.outstanding.label'
    );
  });

  it('caps the raise on the resulting quantity, not on the outstanding one', async () => {
    // Backend `0056`, section 5: a partly settled line cannot be raised past the
    // limit an unsettled one has, so what is already bought comes off the top.
    const fixture = await render(line({ quantity: 5, settled: 2 }));

    expect(reel(fixture).getAttribute('aria-valuemax')).toBe(
      String(LINE_QUANTITY_MAX - 2)
    );
    expect(reel(fixture).getAttribute('aria-valuemin')).toBe('0');
  });

  it('says how many are being bought while the thumb is down', async () => {
    const fixture = await render(line({ quantity: 5 }));

    key(fixture, 'ArrowDown');
    key(fixture, 'ArrowDown');

    expect(text(fixture, '.preview')).toContain('basket.outstanding.bought');
  });

  it('says what it will buy instead, on the way up', async () => {
    // A different sentence, because it is a different act: nothing has been bought,
    // and this basket has decided to carry more than the households asked for.
    const fixture = await render(line({ quantity: 5 }));

    key(fixture, 'ArrowUp');

    expect(text(fixture, '.preview')).toContain('basket.outstanding.buying');
  });

  it('says nothing when the gesture comes back to where it started', async () => {
    const fixture = await render(line({ quantity: 5 }));

    key(fixture, 'ArrowDown');
    key(fixture, 'ArrowUp');

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.preview')
    ).toBeNull();
  });

  it('reports where the run began and where it ended', async () => {
    // Absolute numbers in both halves. `from` is what lets the server refuse a
    // stale gesture rather than apply it as the opposite act (backend `0056`,
    // section 3.2).
    const fixture = await render(line({ quantity: 5 }));
    const moves: { from: number; to: number }[] = [];
    fixture.componentInstance.outstanding.subscribe((move) => moves.push(move));

    key(fixture, 'ArrowDown');
    key(fixture, 'ArrowDown');
    letGo(fixture);

    expect(moves).toEqual([{ from: 5, to: 3 }]);
  });

  it('raises a finished line without ever saying anything is left', async () => {
    // Section 5, and the most likely misreading of this screen. Raising a done line
    // adds demand and reverts no settlement, so the caption says what will be
    // bought rather than what remains.
    const fixture = await render(bought());
    const moves: { from: number; to: number }[] = [];
    fixture.componentInstance.outstanding.subscribe((move) => moves.push(move));

    key(fixture, 'ArrowUp');

    expect(text(fixture, '.preview')).toContain('basket.outstanding.buying');

    letGo(fixture);

    expect(moves).toEqual([{ from: 0, to: 1 }]);
  });

  it('is readable rather than disabled while the write is out', async () => {
    // What the input was built for: the number is real and worth reading while it
    // settles, and a disabled control would say something about this reader that is
    // not true.
    const fixture = await render(line({ quantity: 5 }), { busy: true });

    expect(reel(fixture).getAttribute('aria-readonly')).toBe('true');
  });

  it('still shows how far through a partly settled line is', async () => {
    const fixture = await render(line({ quantity: 5, settled: 2 }));

    expect(text(fixture, '.progress')).toContain('basket.line.partly');
  });
});

describe('BasketLineRow: the tap and the gesture stay apart', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens the sheet on a tap on the words', async () => {
    const fixture = await render(line({ quantity: 5 }));
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    (body(fixture) as HTMLButtonElement).click();

    expect(opened).toHaveLength(1);
  });

  it('does not open it on a tap that was really dismissing the reel', async () => {
    // `line-row`s arrangement, for its reason: the overlay reaches over the row
    // beside it, so the tap that puts it away must not also open a screen over the
    // number somebody was reading. It commits what it was holding instead.
    const fixture = await render(line({ quantity: 5 }));
    const opened: unknown[] = [];
    const moves: { from: number; to: number }[] = [];
    fixture.componentInstance.open.subscribe(() => opened.push(1));
    fixture.componentInstance.outstanding.subscribe((move) => moves.push(move));

    key(fixture, 'ArrowDown');
    (body(fixture) as HTMLButtonElement).click();

    expect(opened).toHaveLength(0);
    expect(moves).toEqual([{ from: 5, to: 4 }]);
  });

  it('does not open it on a click coming out of the reel itself', async () => {
    const fixture = await render(line({ quantity: 5 }));
    const opened: unknown[] = [];
    fixture.componentInstance.open.subscribe(() => opened.push(1));

    reel(fixture).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(opened).toHaveLength(0);
  });
});

describe('BasketLineRow: what somebody else did', () => {
  it('says the number as it now stands, in one sentence', async () => {
    // Section 4.1. The store refetched before it answered, so by the time this is
    // drawn the count beside it is the true one, which is the only thing that makes
    // the sentence worth saying.
    const fixture = await render(line({ quantity: 3 }), {
      notice: { key: 'basket.error.staleLine', count: 3 },
    });

    expect(text(fixture, '.line-notice')).toContain('basket.error.staleLine');
  });

  it('draws nothing at all when there is nothing to report', async () => {
    const fixture = await render(line({ quantity: 3 }));

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.line-notice')
    ).toBeNull();
  });
});
