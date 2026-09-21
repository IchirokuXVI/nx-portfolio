import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  QUANTITY_REEL_IDLE_MS,
  type BasketListRef,
  type BasketRow,
  type BasketRowEntry,
} from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { RowEntries } from './row-entries';

/**
 * What each household asked for, got, and may still be asked to buy (velista
 * `0090` section 9.2, and `0092` section 6).
 *
 * The pane holds **two reels on one row** now, and they mean opposite things:
 * "got" records a purchase, and "asks for" rewrites a household's list for
 * everybody. So what is asserted here is mostly the difference between them —
 * one commits on release and the other does not — and the three conditions that
 * decide whether the second is drawn at all.
 *
 * Assertions are on translation keys rather than on rendered English, because the
 * testing translator echoes keys: the question is which sentence was chosen,
 * never how it reads after a copy edit.
 */

function entry(over: Partial<BasketRowEntry> = {}): BasketRowEntry {
  return {
    lineId: 'zl-1',
    listId: 'l-weekly',
    left: 2,
    bought: 1,
    asked: 3,
    state: 'PARTLY',
    awaitingApproval: false,
    demandEditable: true,
    ...over,
  };
}

function row(entries: readonly BasketRowEntry[]): BasketRow {
  const left = entries.reduce((sum, held) => sum + held.left, 0);
  const bought = entries.reduce((sum, held) => sum + held.bought, 0);
  return {
    rowKey: entries[0]?.lineId ?? 'zl-1',
    content: 'Milk',
    left,
    bought,
    asked: left + bought,
    state: 'PARTLY',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries,
  };
}

const LISTS = new Map<string, BasketListRef>([
  [
    'l-weekly',
    { listId: 'l-weekly', name: 'Weekly shop', zoneId: 'z1', zoneName: 'Flat' },
  ],
  [
    'l-parents',
    { listId: 'l-parents', name: 'Groceries', zoneId: 'z2', zoneName: 'Home' },
  ],
]);

async function render(
  held: BasketRow,
  options: {
    lists?: ReadonlyMap<string, BasketListRef>;
    finished?: boolean;
  } = {}
) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [RowEntries, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RowEntries);
  fixture.componentRef.setInput('row', held);
  fixture.componentRef.setInput('lists', options.lists ?? LISTS);
  fixture.componentRef.setInput('finished', options.finished ?? false);
  fixture.componentRef.setInput('busy', false);
  fixture.detectChanges();

  return fixture;
}

type Fixture = Awaited<ReturnType<typeof render>>;

const html = (fixture: Fixture) => fixture.nativeElement as HTMLElement;

const askReels = (fixture: Fixture) => [
  ...html(fixture).querySelectorAll<HTMLElement>('.ask-reel'),
];

const applyButton = (fixture: Fixture) =>
  html(fixture).querySelector<HTMLButtonElement>('.apply');

/**
 * The keyboard half of the reel, which is a real path and the one a spec can
 * drive: jsdom has no `PointerEvent`, and the keys move the same pending value
 * and commit on the same idle beat.
 */
function key(reel: HTMLElement, fixture: Fixture, name: string): void {
  reel.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true })
  );
  fixture.detectChanges();
}

function letGo(fixture: Fixture): void {
  jest.advanceTimersByTime(QUANTITY_REEL_IDLE_MS);
  fixture.detectChanges();
}

describe('RowEntries: who may change what a list asks for', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('draws the control when the server says the owner may, on a served list', () => {
    // All three conditions of section 6.2 hold.
    return render(row([entry()])).then((fixture) => {
      expect(askReels(fixture)).toHaveLength(1);
    });
  });

  it('draws plain text when the server says the owner may not', async () => {
    // The one field no client can compute: the rule is asked of the **basket's
    // owner** on the entry's list, and a reader never learns those permissions.
    const fixture = await render(row([entry({ demandEditable: false })]));

    expect(askReels(fixture)).toHaveLength(0);
    expect(html(fixture).querySelector('.row-number')).not.toBeNull();
  });

  it('draws it for a guest on a row with one entry', async () => {
    // A guest is served no list refs at all, so `listId` is null. The row has one
    // entry, so there is no ambiguity about which list is being changed, which is
    // backend `0130`'s "single entry rows only".
    const fixture = await render(row([entry({ listId: null })]), {
      lists: new Map(),
    });

    expect(askReels(fixture)).toHaveLength(1);
  });

  it('never draws it for a guest on a row with two entries', async () => {
    // A reader who cannot tell two entries apart is never asked to choose between
    // them: picking the wrong household's list would be invisible to them.
    const fixture = await render(
      row([entry({ listId: null }), entry({ lineId: 'zl-2', listId: null })]),
      { lists: new Map() }
    );

    expect(askReels(fixture)).toHaveLength(0);
  });

  it('takes it off a finished trip', async () => {
    const fixture = await render(row([entry()]), { finished: true });
    expect(askReels(fixture)).toHaveLength(0);
  });

  it('explains nothing when the control is absent', async () => {
    // `0030`: a control you may not use is not drawn, and the person reading has
    // no standing to change it and no use for the reason.
    const fixture = await render(row([entry({ demandEditable: false })]));

    expect(html(fixture).textContent ?? '').not.toContain('basket.demand');
  });

  it('shows the pane for a guest whose one entry they may change', async () => {
    // Without this the pane would stay hidden — a single unserved entry says
    // nothing the row above does not — and hide the only control they have.
    const fixture = await render(row([entry({ listId: null })]), {
      lists: new Map(),
    });

    expect(html(fixture).querySelector('.entries')).not.toBeNull();
  });

  it('still hides the pane for a single unserved entry nobody may change', async () => {
    const fixture = await render(
      row([entry({ listId: null, demandEditable: false })]),
      { lists: new Map() }
    );

    expect(fixture.componentInstance.shows()).toBe(false);
  });
});

describe('RowEntries: the demand control does not commit on release', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes nothing when the reel is let go', async () => {
    const fixture = await render(row([entry()]));
    const demanded = jest.fn();
    fixture.componentInstance.demanded.subscribe(demanded);

    key(askReels(fixture)[0], fixture, 'ArrowUp');
    letGo(fixture);

    // This rewrites a household's list for everybody, the gesture is rare, and a
    // number that a thumb brushed is not a decision.
    expect(demanded).not.toHaveBeenCalled();
  });

  it('offers the button only once the reel has moved', async () => {
    const fixture = await render(row([entry()]));
    expect(applyButton(fixture)).toBeNull();

    key(askReels(fixture)[0], fixture, 'ArrowUp');
    letGo(fixture);

    expect(applyButton(fixture)).not.toBeNull();
  });

  it('says what the change costs, tied to the button', async () => {
    const fixture = await render(row([entry()]));
    key(askReels(fixture)[0], fixture, 'ArrowUp');
    letGo(fixture);

    expect(html(fixture).textContent ?? '').toContain(
      'basket.demand.everybody'
    );
    // Read when the button is **reached** rather than only when it is seen.
    const described = applyButton(fixture)?.getAttribute('aria-describedby');
    expect(described).toBe('demand-zl-1');
    expect(html(fixture).querySelector(`#${described}`)).not.toBeNull();
  });

  it('sends the line, the new number and the one it started from', async () => {
    const fixture = await render(row([entry({ left: 2 })]));
    const demanded = jest.fn();
    fixture.componentInstance.demanded.subscribe(demanded);

    key(askReels(fixture)[0], fixture, 'ArrowUp');
    letGo(fixture);
    applyButton(fixture)?.click();

    // `from` is velista `0054`'s bargain: a write whose starting number has moved
    // is refused rather than applied to a number that moved underneath it.
    expect(demanded).toHaveBeenCalledWith({
      lineId: 'zl-1',
      from: 2,
      to: 3,
    });
  });

  it('names the list on the reel, so two reels are told apart by ear', async () => {
    // Two reels on one row look alike to somebody who sees which column they
    // sit in and identical to somebody who does not, so each names the list and
    // says which question it is asking.
    const fixture = await render(row([entry()]));

    expect(askReels(fixture)[0].getAttribute('aria-label')).toContain(
      'basket.demand.askLabel'
    );
    expect(
      html(fixture).querySelector('.got-reel')?.getAttribute('aria-label')
    ).toContain('basket.entries.gotLabel');
  });

  it('falls back to the plain label for a list nobody may name', async () => {
    // A single unserved entry has no name to give, and there is one list in the
    // row, so there is no ambiguity for a name to resolve.
    const fixture = await render(row([entry({ listId: null })]), {
      lists: new Map(),
    });

    expect(askReels(fixture)[0].getAttribute('aria-label')).toBe(
      'basket.demand.label'
    );
  });
});

describe('RowEntries: the two reels are different controls', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('commits the got reel on release and the ask reel on a button', async () => {
    const fixture = await render(row([entry()]));
    const allocated = jest.fn();
    const demanded = jest.fn();
    fixture.componentInstance.allocated.subscribe(allocated);
    fixture.componentInstance.demanded.subscribe(demanded);

    const got = html(fixture).querySelector<HTMLElement>('.got-reel');
    key(got as HTMLElement, fixture, 'ArrowUp');
    letGo(fixture);

    // A shopper moves this one a dozen times a trip, and a confirmation on each
    // would be the dialog `0043` took off the list page.
    expect(allocated).toHaveBeenCalled();
    expect(demanded).not.toHaveBeenCalled();
  });
});
