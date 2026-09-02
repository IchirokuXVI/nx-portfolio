import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, GatewayError } from '@portfolio/velista/data-access';
import type {
  BasketBindResult,
  BasketLine,
  BasketLineTarget,
  ErrorCode,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { LineListSheet } from './line-list-sheet';

/**
 * Sending a line somebody typed in the shop to a shopping list (plan 0056).
 *
 * Almost every test here is about **which list, said once, on purpose**: that the
 * picker puts the run's own lists where the answer usually is, that nothing is
 * chosen for the reader, that the sheet says the gesture is one way before it
 * commits, and that each of the three things that can happen afterwards is reported
 * rather than left to be guessed from the row.
 *
 * Assertions are on keys and on component state rather than on interpolated copy:
 * `RokuTranslatorTestingModule` returns the key, deliberately, so a test says which
 * string was asked for and not what it currently reads.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const LINE_ID = 'c0ffee00-1111-4222-8333-444455556666';

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: LINE_ID,
    content: 'Batteries',
    quantity: 4,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: 'me',
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    kind: 'ADDED',
    targetListId: null,
    origins: [],
    ...overrides,
  };
}

function target(overrides: Partial<BasketLineTarget> = {}): BasketLineTarget {
  return {
    listId: 'list-weekly',
    zoneId: 'zone-flat',
    listName: 'Weekly shop',
    zoneName: 'Flat 3B',
    fromRun: true,
    ...overrides,
  };
}

/**
 * The picker's ordinary shape: two lists the run drew from, in two different zones,
 * and two more from a zone this basket has never touched.
 *
 * Deliberately out of order and across zones, because both facts are what the
 * grouping has to fix: the server answers a set and sorts nothing (backend `0058`
 * section 3), so a fixture that arrived sorted would pass a version of this that
 * did no work at all.
 */
const TARGETS: readonly BasketLineTarget[] = [
  target({
    listId: 'list-office',
    zoneId: 'zone-office',
    listName: 'Snacks',
    zoneName: 'Office',
    fromRun: false,
  }),
  target({
    listId: 'list-groceries',
    zoneId: 'zone-parents',
    listName: 'Groceries',
    zoneName: 'Parents’ house',
  }),
  target(),
  target({
    listId: 'list-office-cleaning',
    zoneId: 'zone-office',
    listName: 'Cleaning',
    zoneName: 'Office',
    fromRun: false,
  }),
];

function bindResult(
  overrides: Partial<BasketBindResult> = {}
): BasketBindResult {
  return {
    line: line({ targetListId: 'list-weekly' }),
    listId: 'list-weekly',
    zoneId: 'zone-flat',
    createdLineId: 'zl-new',
    quantity: 4,
    pendingApproval: false,
    ...overrides,
  };
}

interface World {
  /** What the targets read answers, or null for a read that fails. */
  readonly targets?: readonly BasketLineTarget[] | null;
  /** What the bind answers, or null for a refusal. */
  readonly bind?: BasketBindResult | null;
  /** The code the store's `error()` holds after a refused bind. */
  readonly bindError?: ErrorCode;
  readonly lines?: readonly BasketLine[];
  readonly basePath?: string;
}

function storeDouble(world: World) {
  const error = signal<unknown>(null);

  return {
    basket: signal(null),
    state: signal('ready'),
    error,
    shareLink: signal(null),
    busyLines: signal(new Set<string>()),
    lines: signal<readonly BasketLine[]>(world.lines ?? [line()]),
    seesZoneData: signal(true),
    listNames: signal(new Map<string, string>()),
    participants: signal([]),
    me: signal(null),
    participantsById: signal(new Map()),
    progress: signal({ settled: 0, total: 0, spent: 0 }),
    pendingTargets: signal(new Set<string>()),
    present: signal([]),
    live: signal(true),
    revoked: signal(false),
    open: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(null),
    reopen: jest.fn().mockResolvedValue(null),
    setPick: jest.fn().mockResolvedValue(null),
    apply: jest.fn(),
    rememberListNames: jest.fn(),
    loadLineTargets: jest.fn(async () => {
      const targets = world.targets === undefined ? TARGETS : world.targets;
      return targets;
    }),
    bindLine: jest.fn(async () => {
      const result = world.bind === undefined ? bindResult() : world.bind;
      if (result === null) {
        error.set(
          new GatewayError({
            code: world.bindError ?? 'conflict',
            status: 409,
            correlationId: 'ref-1',
          })
        );
      }
      return result;
    }),
    loadShareLink: jest.fn().mockResolvedValue(undefined),
    share: jest.fn().mockResolvedValue(null),
    revokeLink: jest.fn().mockResolvedValue(undefined),
    removeParticipant: jest.fn().mockResolvedValue(undefined),
  };
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();

  const store = storeDouble(world);
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  const pageMap = convertToParamMap({ generatedListId: BASKET_ID });
  const sheetMap = convertToParamMap({ lineId: LINE_ID });

  await TestBed.configureTestingModule({
    imports: [LineListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: world.basePath ?? '/velista' }),
      { provide: BasketStore, useValue: store },
      { provide: SheetNavigation, useValue: sheets },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(sheetMap),
          snapshot: {
            paramMap: sheetMap,
            parent: { paramMap: pageMap, parent: null },
          },
          parent: {
            paramMap: of(pageMap),
            snapshot: { paramMap: pageMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LineListSheet);
  fixture.detectChanges();
  await settle(fixture);

  return { fixture, store, sheets };
}

/**
 * Let the reads and the writes resolve, then draw.
 *
 * Microtasks rather than `whenStable`, which can hang in a zoneless spec: the sheet
 * loads its targets in the constructor, so the first paint is always one turn behind
 * the answer.
 */
async function settle(fixture: ComponentFixture<LineListSheet>) {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

const el = (fixture: ComponentFixture<LineListSheet>) =>
  fixture.nativeElement as HTMLElement;

const text = (fixture: ComponentFixture<LineListSheet>) =>
  el(fixture).textContent ?? '';

const headings = (fixture: ComponentFixture<LineListSheet>) =>
  [...el(fixture).querySelectorAll('.group-heading')].map(
    (node) => node.textContent?.trim() ?? ''
  );

const names = (fixture: ComponentFixture<LineListSheet>) =>
  [...el(fixture).querySelectorAll('.target-name')].map(
    (node) => node.textContent?.trim() ?? ''
  );

const radios = (fixture: ComponentFixture<LineListSheet>) => [
  ...el(fixture).querySelectorAll<HTMLInputElement>('.target-radio'),
];

/** Choose one list the way a tap on its row does. */
async function choose(
  fixture: ComponentFixture<LineListSheet>,
  listId: string
) {
  const index = radios(fixture).findIndex((radio) => radio.value === listId);
  radios(fixture)[index].dispatchEvent(new Event('change'));
  await settle(fixture);
}

/** Type in the search field. */
async function search(fixture: ComponentFixture<LineListSheet>, query: string) {
  const field = el(fixture).querySelector<HTMLInputElement>('.search-field');
  if (field === null) {
    throw new Error('there is no search field');
  }
  field.value = query;
  field.dispatchEvent(new Event('input'));
  await settle(fixture);
}

async function confirm(fixture: ComponentFixture<LineListSheet>) {
  el(fixture).querySelector<HTMLButtonElement>('.primary')?.click();
  await settle(fixture);
}

describe('LineListSheet: which list this goes to', () => {
  describe('opening it', () => {
    it('asks which lists this line may be sent to', async () => {
      const { store } = await render();

      expect(store.loadLineTargets).toHaveBeenCalledWith(LINE_ID);
    });

    it('is titled by the line, in the words the reader typed', async () => {
      const { fixture } = await render();

      expect(
        el(fixture).querySelector('#line-list-title')?.textContent?.trim()
      ).toBe('Batteries');
    });

    it('offers a retry when the read fails, and does not draw a picker', async () => {
      const { fixture } = await render({ targets: null });

      expect(text(fixture)).toContain('basket.send.loadFailed');
      expect(el(fixture).querySelector('.picker')).toBeNull();
      expect(text(fixture)).toContain('basket.send.retry');
    });

    it('says so when there is nowhere to send it', async () => {
      const { fixture } = await render({ targets: [] });

      expect(text(fixture)).toContain('basket.send.empty');
      expect(el(fixture).querySelector('.picker')).toBeNull();
    });
  });

  describe('the picker', () => {
    it('puts the lists this basket came from first, in their own group', async () => {
      const { fixture } = await render();

      // The run's group is the one a reader moving by heading reaches first, because
      // the line was almost certainly remembered while shopping for one of these.
      expect(headings(fixture)[0]).toBe('basket.send.fromThisBasket');
    });

    it('groups everything else by zone, zones and lists alphabetically', async () => {
      const { fixture } = await render();

      expect(headings(fixture)).toEqual([
        'basket.send.fromThisBasket',
        'Office',
      ]);
      // Within the run's group, and then within the zone's, by list name. The
      // fixture arrives in neither order, because the server sorts nothing.
      expect(names(fixture)).toEqual([
        'Groceries',
        'Weekly shop',
        'Cleaning',
        'Snacks',
      ]);
    });

    it('names the zone on a run row and not under a zone heading', async () => {
      const { fixture } = await render();

      const zones = [...el(fixture).querySelectorAll('.target-zone')].map(
        (node) => node.textContent?.trim() ?? ''
      );
      // Only the run's group, whose rows come from several zones and are the only
      // ones a heading does not already place.
      expect(zones).toEqual(['Parents’ house', 'Flat 3B']);
    });

    it('offers a list the run drew from once, and not again under its zone', async () => {
      const { fixture } = await render();

      expect(
        names(fixture).filter((name) => name === 'Weekly shop')
      ).toHaveLength(1);
    });

    it('is one radio group, so it is one question with one answer', async () => {
      const { fixture } = await render();

      expect(el(fixture).querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(radios(fixture)).toHaveLength(TARGETS.length);
    });

    it('preselects nothing and offers no confirm until a list is chosen', async () => {
      const { fixture } = await render();

      // A preselected row is a default that can be committed by accident, and the
      // whole gesture is somebody saying which list.
      expect(radios(fixture).some((radio) => radio.checked)).toBe(false);
      expect(el(fixture).querySelector('.primary')).toBeNull();
    });
  });

  describe('the search', () => {
    /** Nine lists, which is one past the threshold the field appears at. */
    const many: readonly BasketLineTarget[] = Array.from(
      { length: 9 },
      (_unused, index) =>
        target({
          listId: `list-${index}`,
          zoneId: `zone-${index}`,
          listName: index === 0 ? 'Weekly shop' : `List ${index}`,
          zoneName: index === 0 ? 'Flat 3B' : `Group ${index}`,
          fromRun: false,
        })
    );

    it('is absent while the lists fit on a screen', async () => {
      const { fixture } = await render();

      expect(el(fixture).querySelector('.search-field')).toBeNull();
    });

    it('appears once there are more than a screenful', async () => {
      const { fixture } = await render({ targets: many });

      expect(el(fixture).querySelector('.search-field')).not.toBeNull();
      expect(
        el(fixture).querySelector('label[for="line-list-search"]')
      ).not.toBeNull();
    });

    it('filters on the list name', async () => {
      const { fixture } = await render({ targets: many });

      await search(fixture, 'weekly');

      expect(names(fixture)).toEqual(['Weekly shop']);
    });

    it('filters on the zone name too, because either half is what gets remembered', async () => {
      const { fixture } = await render({ targets: many });

      await search(fixture, 'flat');

      expect(names(fixture)).toEqual(['Weekly shop']);
    });

    it('announces how many are left, politely', async () => {
      const { fixture } = await render({ targets: many });

      const region = el(fixture).querySelector('.matches');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(region?.textContent).toContain('basket.send.matches');

      await search(fixture, 'weekly');

      // The count is component state; the testing translator does not interpolate.
      expect(names(fixture)).toHaveLength(1);
    });

    it('keeps the field when a filter narrows the list below the threshold', async () => {
      const { fixture } = await render({ targets: many });

      await search(fixture, 'weekly');

      // Taking away the field that narrowed it would strand the reader with one row
      // and no way back to the rest.
      expect(el(fixture).querySelector('.search-field')).not.toBeNull();
    });
  });

  describe('the one way warning', () => {
    it('names the line and the list, above the confirm', async () => {
      const { fixture } = await render();

      await choose(fixture, 'list-groceries');

      const say = el(fixture).querySelector('.say');
      expect(say?.textContent).toContain('basket.send.warning');
      expect(say?.getAttribute('aria-live')).toBe('polite');
      // What that sentence names, which the testing translator will not interpolate.
      const sheet = fixture.componentInstance as unknown as {
        sayParams: () => { content: string; list: string };
      };
      expect(sheet.sayParams()).toEqual({
        content: 'Batteries',
        list: 'Groceries',
      });
    });

    it('is in the same region the outcome later uses', async () => {
      const { fixture } = await render();

      await choose(fixture, 'list-weekly');
      const before = el(fixture).querySelector('.say');

      await confirm(fixture);

      // The same element, so the sentence is announced when it arrives rather than
      // arriving with a region some readers never announce.
      expect(el(fixture).querySelector('.say')).toBe(before);
    });

    it('draws the confirm only once a list is chosen', async () => {
      const { fixture } = await render();

      expect(el(fixture).querySelector('.primary')).toBeNull();

      await choose(fixture, 'list-weekly');

      expect(text(fixture)).toContain('basket.send.confirm');
    });
  });

  describe('sending it', () => {
    it('binds the line to the list that was chosen', async () => {
      const { fixture, store } = await render();

      await choose(fixture, 'list-groceries');
      await confirm(fixture);

      expect(store.bindLine).toHaveBeenCalledWith(LINE_ID, 'list-groceries');
    });

    it('says it landed', async () => {
      const { fixture } = await render();

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      expect(text(fixture)).toContain('basket.send.done');
      expect(el(fixture).querySelector('.picker')).toBeNull();
      expect(text(fixture)).toContain('basket.send.close');
    });

    it('says it is waiting when the list has not agreed yet', async () => {
      const { fixture } = await render({
        bind: bindResult({ pendingApproval: true }),
      });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      // Drawing "added" for a line the flat has not accepted would be the screen
      // claiming an outcome it does not have (section 5.1).
      expect(text(fixture)).toContain('basket.send.waiting');
      expect(text(fixture)).not.toContain('basket.send.done');
    });

    it('says nothing was outstanding when the line was already bought', async () => {
      const { fixture } = await render({ bind: bindResult({ quantity: 0 }) });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      // "The flat now knows about batteries and does not need any today" is a
      // strange outcome to arrive at silently (section 5.2).
      expect(text(fixture)).toContain('basket.send.noneOutstanding');
    });

    it('says it is waiting even when nothing was outstanding', async () => {
      const { fixture } = await render({
        bind: bindResult({ quantity: 0, pendingApproval: true }),
      });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      // The more surprising of the two facts wins: they have not agreed yet.
      expect(text(fixture)).toContain('basket.send.waiting');
    });

    it('says it once and then offers close', async () => {
      const { fixture } = await render();

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      expect(el(fixture).querySelectorAll('.say')).toHaveLength(1);
      expect(el(fixture).querySelector('.primary')).toBeNull();
    });
  });

  describe('a refusal', () => {
    const REFUSALS: readonly {
      readonly code: ErrorCode;
      readonly key: string;
      readonly refreshes: boolean;
    }[] = [
      // The entry will be gone on the next basket read, so the sheet catches the
      // screen underneath up rather than leaving a control that would refuse again.
      { code: 'conflict', key: 'basket.error.alreadySent', refreshes: true },
      {
        code: 'validation_failed',
        key: 'basket.error.notSendable',
        refreshes: true,
      },
      // Access, not state. A refresh would spend a request and change nothing.
      {
        code: 'forbidden',
        key: 'basket.error.accessChanged',
        refreshes: false,
      },
      {
        code: 'generated_list_finished',
        key: 'basket.error.basketFinished',
        refreshes: false,
      },
    ];

    it.each(REFUSALS)('says what $code means', async ({ code, key }) => {
      const { fixture } = await render({ bind: null, bindError: code });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      expect(text(fixture)).toContain(key);
    });

    it.each(REFUSALS)('keeps the sheet open after $code', async ({ code }) => {
      const { fixture, sheets } = await render({ bind: null, bindError: code });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);

      // One tap from choosing a different list, with the sentence explaining why
      // still on screen.
      expect(sheets.dismiss).not.toHaveBeenCalled();
      expect(el(fixture).querySelector('.picker')).not.toBeNull();
      expect(text(fixture)).not.toContain('basket.send.done');
    });

    it.each(REFUSALS)(
      're-reads the basket after $code: $refreshes',
      async ({ code, refreshes }) => {
        const { fixture, store } = await render({
          bind: null,
          bindError: code,
        });

        await choose(fixture, 'list-weekly');
        await confirm(fixture);

        expect(store.refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
      }
    );

    it('drops the sentence when a different list is chosen', async () => {
      const { fixture } = await render({ bind: null, bindError: 'conflict' });

      await choose(fixture, 'list-weekly');
      await confirm(fixture);
      expect(text(fixture)).toContain('basket.error.alreadySent');

      await choose(fixture, 'list-groceries');

      // A refusal is about the list that was tried, and the reader has moved off it.
      expect(text(fixture)).not.toContain('basket.error.alreadySent');
    });
  });

  describe('going back', () => {
    it('dismisses onto the settle sheet it was opened from', async () => {
      const { fixture, sheets } = await render();

      fixture.debugElement
        .query(By.directive(SheetShell))
        .componentInstance.dismiss.emit();
      await settle(fixture);

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/velista/en/shopping-lists/${BASKET_ID}/sheet/lines/${LINE_ID}/settle`
      );
    });

    it('names it in the standalone build too', async () => {
      // The mount is `/velista` under the shell and `''` on velista's own origin. A
      // sheet that wrote either one down would close onto a 404 in the other.
      const { fixture, sheets } = await render({ basePath: '' });

      fixture.debugElement
        .query(By.directive(SheetShell))
        .componentInstance.dismiss.emit();
      await settle(fixture);

      expect(sheets.dismiss).toHaveBeenCalledWith(
        `/en/shopping-lists/${BASKET_ID}/sheet/lines/${LINE_ID}/settle`
      );
    });
  });
});
