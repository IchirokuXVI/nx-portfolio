import { type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  MappingSettingsStore,
  MEMORY_OTHER_WALK_ID,
  MEMORY_SHOWN_WALK_ID,
} from '@portfolio/velista/data-access';
import type { ShopWalkHistoryRow } from '@portfolio/velista/models';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import {
  headerOf,
  settle,
  shopMapTesting,
  type ShopMapHarnessOptions,
} from '../shop-map.testing';
import { DeleteWalkSheet } from './delete-walk-sheet';
import { MappingSettingsPage } from './mapping-settings-page';
import { NewWalkSheet } from './new-walk-sheet';
import { ResumeWarningSheet } from './resume-warning-sheet';
import { ShopWalksPage } from './shop-walks-page';
import {
  historyDays,
  historyRowView,
  WalkHistoryPage,
} from './walk-history-page';
import { WalkRewindPage } from './walk-rewind-page';

const SHOP = 'loc-tejares';
const BASE = `/en/shops/${SHOP}/walks`;

async function render<T>(
  component: Type<T>,
  options: ShopMapHarnessOptions & { cold?: boolean } = {}
) {
  TestBed.resetTestingModule();
  const harness = shopMapTesting({
    params: { locationId: SHOP, walkId: MEMORY_SHOWN_WALK_ID },
    ...options,
  });
  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: harness.providers,
  }).compileComponents();
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const navigateTo = jest
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  if (!options.cold) {
    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());
  }
  return { fixture, navigate, navigateTo, ...harness };
}

function all(fixture: ComponentFixture<unknown>, selector: string): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  ).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

function click(fixture: ComponentFixture<unknown>, selector: string): void {
  (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLElement>(selector)
    ?.click();
  fixture.detectChanges();
}

/** Velista `0122`, target 2: a shop's walks. */
describe('ShopWalksPage', () => {
  it('lists the walks, the shown one first and marked', async () => {
    const { fixture } = await render(ShopWalksPage);

    expect(all(fixture, '.walk-name')).toEqual(['Autumn layout', 'First try']);
    expect(all(fixture, '.shown')).toEqual(['shopWalks.list.shown']);
    expect(all(fixture, '.subtitle')).toEqual([
      'Mercadona · Ronda de los Tejares 32',
    ]);
  });

  it('opens a walk from its row, and the settings for every walk from the bar', async () => {
    const { fixture, navigate } = await render(ShopWalksPage);

    click(fixture, '.walk-main');
    click(fixture, '[libPageHeaderAction]');

    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/${MEMORY_SHOWN_WALK_ID}`,
      `${BASE}/settings`,
    ]);
  });

  // Velista 0129, targets 7 and 8.
  it('draws no sentence above the list, no note under the button and no button on a row', async () => {
    const { fixture } = await render(ShopWalksPage);

    expect(all(fixture, '.intro')).toEqual([]);
    expect(all(fixture, '.foot-note')).toEqual([]);
    expect(all(fixture, '.walk button')).toEqual([]);
    expect(all(fixture, '.foot button')).toEqual(['shopWalks.list.start']);
  });

  it('asks for a new walk’s name in a sheet over the list', async () => {
    const { fixture, navigateTo } = await render(ShopWalksPage);

    click(fixture, '.foot .primary');

    expect(navigateTo.mock.calls[0][0]).toEqual(['sheet', 'new']);
  });

  // Velista 0130: one header, with the gear for the settings of every walk.
  it('draws the header before the walks arrive and after, with the shop under it', async () => {
    const { fixture } = await render(ShopWalksPage, { cold: true });
    const drawn = {
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'shopWalks.list.title',
      actions: ['shopWalks.mapping.title'],
    };

    expect(headerOf(fixture)).toEqual(drawn);
    expect(all(fixture, '.content [role="status"]')).toHaveLength(1);

    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());

    expect(headerOf(fixture)).toEqual(drawn);
    expect(all(fixture, '[libPageHeaderAction] lib-gear-icon')).toHaveLength(1);
    expect(all(fixture, 'lib-page-header .subtitle')).toEqual([]);
    expect(all(fixture, '.content > :first-child')).toEqual([
      'Mercadona · Ronda de los Tejares 32',
    ]);
  });

  it('goes back to the map when there is nothing to pop', async () => {
    const { fixture, pages } = await render(ShopWalksPage);

    click(fixture, 'lib-page-header .lead');

    expect(pages.back).toHaveBeenCalledWith(`/en/shops/${SHOP}/map`);
  });
});

describe('NewWalkSheet', () => {
  it('starts a walk with the name given and leaves for recording it (velista 0126)', async () => {
    const { fixture, sheets, walks } = await render(NewWalkSheet);
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      'input'
    ) as HTMLInputElement;
    field.value = 'Spring';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    await (fixture.componentInstance as NewWalkSheet).start();

    const list = await walks.list(SHOP);
    const made =
      list.kind === 'walks'
        ? list.walks.find((w) => w.name === 'Spring')
        : null;
    expect(made).toBeDefined();
    expect(sheets.leaveTo).toHaveBeenCalledWith(`${BASE}/${made?.id}/record`);
  });

  it('holds a name to keep before anybody types', async () => {
    const { fixture } = await render(NewWalkSheet);
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      'input'
    ) as HTMLInputElement;

    expect(field.value).toBe('shopWalks.new.defaultName');
  });
});

describe('historyRowView', () => {
  const row = (partial: Partial<ShopWalkHistoryRow>): ShopWalkHistoryRow => ({
    id: 'r',
    kind: 'started',
    seqs: [1],
    at: new Date(2026, 8, 30, 13, 1),
    logMs: 0,
    walkedMs: null,
    marks: null,
    changes: null,
    checked: false,
    discarded: false,
    reason: null,
    rewoundTo: null,
    undoes: null,
    beforeProblem: false,
    ...partial,
  });

  it('says how long a session walked and how many marks it put', () => {
    const view = historyRowView(
      row({ kind: 'resumed', walkedMs: 240_000, marks: 6 }),
      'en',
      true
    );

    expect(view.time).toBe('13:01');
    expect(view.latest).toBe(true);
    expect(view.title.key).toBe('shopWalks.history.resumed');
    expect(view.details).toEqual([
      { key: 'shopWalks.history.walked', values: { count: 4 } },
      { key: 'shopWalks.list.marks', values: { count: 6 } },
    ]);
  });

  it('says a tracking stop kept the walk up to its time, and the purple path went', () => {
    const view = historyRowView(
      row({ kind: 'problem', reason: 'tracking-lost', discarded: true }),
      'en',
      false
    );

    expect(view.title.key).toBe('shopWalks.history.trackingLost');
    expect(view.details.map((part) => part.key)).toEqual([
      'shopWalks.history.keptUntil',
      'shopWalks.history.purpleDiscarded',
    ]);
  });

  it('names the moment a rewind went back to, and the rewind it undid', () => {
    const view = historyRowView(
      row({
        kind: 'rewound',
        rewoundTo: new Date(2026, 8, 30, 13, 14),
        undoes: new Date(2026, 8, 30, 13, 16),
      }),
      'en',
      false
    );

    expect(view.title).toEqual({
      key: 'shopWalks.history.rewound',
      values: { time: '13:14' },
    });
    expect(view.details).toEqual([
      { key: 'shopWalks.history.undoes', values: { time: '13:16' } },
    ]);
  });

  it('groups rows by the day they happened', () => {
    const now = new Date(2026, 8, 30, 18);
    const days = historyDays(
      [
        row({ id: 'a', at: new Date(2026, 8, 30, 13) }),
        row({ id: 'b', at: new Date(2026, 8, 30, 12) }),
        row({ id: 'c', at: new Date(2026, 8, 14, 11) }),
      ],
      'en',
      now
    );

    expect(days.map((day) => day.name)).toEqual([
      { kind: 'today' },
      { kind: 'date', text: 'September 14' },
    ]);
    expect(days[0].rows.map((one) => [one.id, one.latest])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});

/** Velista `0122`, target 3, and `0129`, target 8: one page per walk. */
describe('WalkHistoryPage', () => {
  it('holds everything about the walk, in the order somebody needs it', async () => {
    const { fixture } = await render(WalkHistoryPage);
    // Under the header, whose own actions slot shares a class name with the page's.
    const order = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.content :is(.field, .switch, .actions, .entries, .delete)'
      )
    ).map((node) => node.className.split(' ')[0]);

    expect(order[0]).toBe('field');
    expect(order[1]).toBe('switch');
    expect(order[2]).toBe('actions');
    expect(order[3]).toBe('entries');
    expect(order[order.length - 1]).toBe('delete');
    expect(all(fixture, '.switch-hint')).toEqual([
      'shopWalks.settings.showHint',
    ]);
    // No button for a settings page: there is none any more.
    expect(headerOf(fixture).actions).toEqual([]);
  });

  // Velista 0130: the header never waits for the walk.
  it('titles the header Walk until the walk arrives, then with its name', async () => {
    const { fixture } = await render(WalkHistoryPage, { cold: true });

    expect(headerOf(fixture)).toEqual({
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'shopWalks.history.loadingTitle',
      actions: [],
    });

    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());

    expect(headerOf(fixture)).toEqual({
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'Autumn layout',
      actions: [],
    });
  });

  it('renames the walk when the field is left, and says so', async () => {
    const { fixture, walks } = await render(WalkHistoryPage);
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '.field'
    ) as HTMLInputElement;
    expect(field.value).toBe('Autumn layout');

    field.value = 'Winter';
    field.dispatchEvent(new Event('input'));
    await (fixture.componentInstance as WalkHistoryPage).saveName();
    fixture.detectChanges();

    const read = await walks.walk(MEMORY_SHOWN_WALK_ID);
    expect(read.kind === 'walk' && read.detail.walk.name).toBe('Winter');
    expect(all(fixture, '.notice')).toEqual([
      'shopWalks.settings.notice.renamed',
    ]);
    expect(all(fixture, '.title')).toEqual(['Winter']);
  });

  it('saves a changed name when the page goes away with no blur', async () => {
    const { fixture, walks } = await render(WalkHistoryPage);
    const field = (fixture.nativeElement as HTMLElement).querySelector(
      '.field'
    ) as HTMLInputElement;

    field.value = 'Left by the chevron';
    field.dispatchEvent(new Event('input'));
    fixture.destroy();
    await settle(() => undefined);

    const read = await walks.walk(MEMORY_SHOWN_WALK_ID);
    expect(read.kind === 'walk' && read.detail.walk.name).toBe(
      'Left by the chevron'
    );
  });

  it('shows another walk to shoppers from its switch, and says so', async () => {
    const { fixture, walks } = await render(WalkHistoryPage, {
      params: { locationId: SHOP, walkId: MEMORY_OTHER_WALK_ID },
    });
    const box = (fixture.nativeElement as HTMLElement).querySelector(
      '.switch'
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);

    box.checked = true;
    await (fixture.componentInstance as WalkHistoryPage).setShown({
      target: box,
    } as unknown as Event);
    fixture.detectChanges();

    const list = await walks.list(SHOP);
    expect(
      list.kind === 'walks' &&
        list.walks.filter((walk) => walk.shown).map((walk) => walk.id)
    ).toEqual([MEMORY_OTHER_WALK_ID]);
    expect(all(fixture, '.notice')).toEqual([
      'shopWalks.settings.notice.shown',
    ]);
  });

  it('asks before deleting, in a sheet over the walk', async () => {
    const { fixture, navigateTo } = await render(WalkHistoryPage);

    click(fixture, '.delete');

    expect(navigateTo.mock.calls[0][0]).toEqual(['sheet', 'delete']);
  });

  it('names the walk and draws its sessions, not its saves', async () => {
    const { fixture } = await render(WalkHistoryPage);

    expect(all(fixture, '.title')).toEqual(['Autumn layout']);
    expect(all(fixture, '.entry-title')).toEqual([
      'shopWalks.history.rewound',
      'shopWalks.history.edited',
      'shopWalks.history.resumed',
      'shopWalks.history.trackingLost',
      'shopWalks.history.started',
    ]);
    expect(all(fixture, '.latest')).toEqual(['shopWalks.history.latest']);
  });

  it('offers Rewind, Edit map and Resume walking', async () => {
    const { fixture, navigate } = await render(WalkHistoryPage);

    expect(all(fixture, '.actions button')).toEqual([
      'shopWalks.history.rewind',
      'shopWalks.history.editMap',
      'shopWalks.history.resume',
    ]);
    click(fixture, '.actions .secondary');
    click(fixture, '.actions .edit-map');

    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/${MEMORY_SHOWN_WALK_ID}/rewind`,
      `${BASE}/${MEMORY_SHOWN_WALK_ID}/edit`,
    ]);
  });

  // Velista 0126, target 1.
  it('warns first before resuming the walk shoppers see', async () => {
    const { fixture, navigate, navigateTo } = await render(WalkHistoryPage);

    click(fixture, '.actions .resume');

    expect(navigate).not.toHaveBeenCalled();
    expect(navigateTo.mock.calls[0][0]).toEqual(['sheet', 'resume']);
  });

  it('goes straight to recording a walk shoppers do not see', async () => {
    const { fixture, navigate } = await render(WalkHistoryPage, {
      params: { locationId: SHOP, walkId: MEMORY_OTHER_WALK_ID },
    });

    click(fixture, '.actions .resume');

    expect(navigate).toHaveBeenCalledWith(
      `${BASE}/${MEMORY_OTHER_WALK_ID}/record`
    );
  });

  it('says in one line why it cannot resume without camera tracking', async () => {
    const { fixture } = await render(WalkHistoryPage, { camera: false });

    expect(all(fixture, '.actions button')).toEqual([
      'shopWalks.history.rewind',
      'shopWalks.history.editMap',
    ]);
    expect(all(fixture, '.no-camera')).toEqual(['shopWalks.history.noCamera']);
  });

  it('says a deleted walk is not there', async () => {
    const { fixture } = await render(WalkHistoryPage, {
      params: {
        locationId: SHOP,
        walkId: '7a1c0f5e-0122-4a00-8000-00000000dead',
      },
    });

    expect(all(fixture, '.empty')).toEqual(['shopWalks.history.missing']);
    expect(headerOf(fixture).title).toBe('shopWalks.history.loadingTitle');
  });
});

/** Velista `0122`, target 4: rewind. */
describe('WalkRewindPage', () => {
  function view(fixture: ComponentFixture<unknown>): ShopMapView {
    return fixture.debugElement.query(By.directive(ShopMapView))
      .componentInstance as ShopMapView;
  }

  // Velista 0130: left with the X, and the shop on a line under the header.
  it('draws the header with a close, before the log arrives and after', async () => {
    const { fixture, pages } = await render(WalkRewindPage, { cold: true });
    const drawn = {
      lead: 'close',
      leadLabel: 'shopWalks.rewind.close',
      title: 'shopWalks.rewind.title',
      actions: [],
    };

    expect(headerOf(fixture)).toEqual(drawn);

    await settle(() => fixture.detectChanges());
    await settle(() => fixture.detectChanges());

    expect(headerOf(fixture)).toEqual(drawn);
    expect(all(fixture, 'lib-page-header .subtitle')).toEqual([]);
    expect(all(fixture, 'lib-page-header + .subtitle')).toEqual([
      'Mercadona · Ronda de los Tejares 32',
    ]);

    click(fixture, 'lib-page-header .lead');
    expect(pages.back).toHaveBeenCalledTimes(1);
  });

  it('opens at now, with nothing faded and nothing to continue from', async () => {
    const { fixture } = await render(WalkRewindPage);

    expect(view(fixture).look()).toBe('mapper');
    expect(view(fixture).fadedAfter()).toBeNull();
    const primary = (fixture.nativeElement as HTMLElement).querySelector(
      '.primary'
    );
    expect(primary?.getAttribute('aria-disabled')).toBe('true');
  });

  // Velista 0129, target 9: the end of the log is now, and going there is no change.
  it('appends nothing when asked to continue from the end of the log', async () => {
    const { fixture, walks } = await render(WalkRewindPage);
    const range = (fixture.nativeElement as HTMLElement).querySelector(
      '.range'
    ) as HTMLInputElement;

    // The slider's top is a whole step at or past the end.
    range.value = range.max;
    range.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click(fixture, '.primary');
    await (fixture.componentInstance as WalkRewindPage).continueHere();

    expect(all(fixture, '.primary')).toEqual(['shopWalks.rewind.pick']);
    expect(walks.appended).toEqual([]);
  });

  it('draws a tick for every entry and a button for every history row', async () => {
    const { fixture } = await render(WalkRewindPage);

    expect(all(fixture, '.tick')).toHaveLength(9);
    expect(all(fixture, '.jump-title')).toEqual([
      'shopWalks.history.started',
      'shopWalks.history.trackingLost',
      'shopWalks.history.resumed',
      'shopWalks.history.edited',
      'shopWalks.history.rewound',
    ]);
  });

  it('fades what came after a moment, and continues from it with one more entry', async () => {
    const { fixture, walks, pages } = await render(WalkRewindPage);

    click(fixture, '.jump');
    expect(view(fixture).fadedAfter()?.logMs).toBe(0);

    const range = (fixture.nativeElement as HTMLElement).querySelector(
      '.range'
    ) as HTMLInputElement;
    range.value = '90000';
    range.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await (fixture.componentInstance as WalkRewindPage).continueHere();

    expect(walks.appended).toEqual([
      expect.objectContaining({
        kind: 'rewound',
        baseSeq: 9,
        rewoundTo: 90_000,
      }),
    ]);
    expect(pages.back).toHaveBeenCalledWith(`${BASE}/${MEMORY_SHOWN_WALK_ID}`);
  });

  it('says so when another phone saved first, and stays', async () => {
    const { fixture, walks, pages } = await render(WalkRewindPage);
    walks.appendElsewhere(MEMORY_SHOWN_WALK_ID);

    click(fixture, '.jump');
    await (fixture.componentInstance as WalkRewindPage).continueHere();
    fixture.detectChanges();

    expect(all(fixture, '.notice')).toEqual([
      'shopWalks.rewind.notice.changed',
    ]);
    expect(pages.back).not.toHaveBeenCalled();
  });
});

describe('DeleteWalkSheet', () => {
  // Velista 0129: the sheet sits over the walk's page, not over its settings.
  it('falls back to the walk’s page when it is dismissed on a cold load', async () => {
    const { fixture, sheets } = await render(DeleteWalkSheet);

    await (fixture.componentInstance as DeleteWalkSheet).dismiss();

    expect(sheets.dismiss).toHaveBeenCalledWith(
      `${BASE}/${MEMORY_SHOWN_WALK_ID}`
    );
  });

  it('deletes the walk and leaves for the list', async () => {
    const { fixture, sheets, walks } = await render(DeleteWalkSheet, {
      params: { locationId: SHOP, walkId: MEMORY_OTHER_WALK_ID },
    });

    await (fixture.componentInstance as DeleteWalkSheet).confirm();

    expect(await walks.walk(MEMORY_OTHER_WALK_ID)).toEqual({ kind: 'missing' });
    expect(sheets.leaveTo).toHaveBeenCalledWith(BASE);
  });
});

/** Velista `0122`, target 7: the warning before resuming the shown walk. */
describe('ResumeWarningSheet', () => {
  it('offers Resume anyway, Start a new walk and Cancel', async () => {
    const { fixture } = await render(ResumeWarningSheet);

    expect(all(fixture, 'button:not(.scrim)')).toEqual([
      'shopWalks.resume.anyway',
      'shopWalks.list.start',
      'shopWalks.cancel',
    ]);
  });

  it('leads to recording (velista 0126) or to naming a new walk', async () => {
    const { fixture, sheets } = await render(ResumeWarningSheet);

    click(fixture, '.primary');
    click(fixture, '.secondary');

    expect(sheets.leaveTo.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/${MEMORY_SHOWN_WALK_ID}/record`,
      `${BASE}/sheet/new`,
    ]);
  });
});

/** Velista `0122`, target 6: the settings for every walk. */
describe('MappingSettingsPage', () => {
  // Velista 0130.
  it('draws the header with a way back and no action', async () => {
    const { fixture, pages } = await render(MappingSettingsPage);

    expect(headerOf(fixture)).toEqual({
      lead: 'back',
      leadLabel: 'shopWalks.back',
      title: 'shopWalks.mapping.title',
      actions: [],
    });

    click(fixture, 'lib-page-header .lead');
    expect(pages.back).toHaveBeenCalledTimes(1);
  });

  it('turns walking across a shelf into a path on and off, on this device', async () => {
    const { fixture } = await render(MappingSettingsPage);
    const box = (fixture.nativeElement as HTMLElement).querySelector(
      '.switch'
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);

    box.click();
    fixture.detectChanges();

    expect(TestBed.inject(MappingSettingsStore).settings()).toEqual({
      walkingAcrossMakesPath: false,
    });
  });
});
