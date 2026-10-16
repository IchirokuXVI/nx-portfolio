import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketChangeStore,
  BasketStore,
  fakeMemberNames,
  provideFakeMemberNames,
} from '@portfolio/velista/data-access';
import type {
  BasketChange,
  BasketListRef,
  BasketParticipant,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import type { ChangeEntryView } from '@portfolio/velista/ui';
import { ChangeAcknowledger } from '../basket-page/change-acknowledger';
import { ChangesSheet } from './changes-sheet';

/**
 * The sheet that tells each change in words (velista `0093`, section 6).
 *
 * What it owns, and what a spec therefore has to hold it to: the four states,
 * the second page that keeps focus and announces, the three ways to name an
 * actor, and the fact that **nothing on it is a control**. The sentences
 * themselves belong to `basketChangeSentence` and are asserted in `models`.
 */

const LIST: BasketListRef = {
  listId: 'list-weekly',
  name: 'Weekly shop',
  zoneId: 'z1',
  zoneName: 'Flat 3B',
};

const ME: BasketParticipant = {
  id: 'p-me',
  kind: 'OWNER',
  displayName: null,
  username: 'Dani',
  guestNumber: null,
  userId: 'u-me',
  joinedAt: null,
  lastSeenAt: null,
  shareLinkId: null,
};

function change(over: Partial<BasketChange> = {}): BasketChange {
  return {
    id: 'chg-1',
    kind: 'RENAMED',
    rowKey: 'zl-1',
    contentBefore: 'Leche',
    contentAfter: 'Milk',
    quantityBefore: null,
    quantityAfter: null,
    approvalBefore: null,
    approvalAfter: null,
    rowContent: null,
    actor: null,
    origin: null,
    list: null,
    at: new Date('2026-09-01T09:00:00.000Z'),
    unseen: false,
    ...over,
  };
}

interface Options {
  readonly state?: 'loading' | 'ready' | 'failed';
  readonly entries?: readonly BasketChange[];
  readonly hasMore?: boolean;
  readonly loadMore?: jest.Mock;
  /** The zone members the app holds, by user id. */
  readonly members?: Readonly<Record<string, string>>;
  /** Who reads the sheet. The owner, by default. */
  readonly me?: BasketParticipant;
  /** The basket the page holds, or null before its first read. */
  readonly basket?: WritableSignal<{ id: string } | null>;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const state = signal(options.state ?? 'ready');
  const entries: WritableSignal<readonly BasketChange[]> = signal(
    options.entries ?? []
  );
  const load = jest.fn().mockResolvedValue(undefined);
  const loadMore = options.loadMore ?? jest.fn().mockResolvedValue(0);
  const dismiss = jest.fn().mockResolvedValue(undefined);
  const reportSheetEntries = jest.fn();
  const names = fakeMemberNames(options.members ?? {});

  await TestBed.configureTestingModule({
    imports: [ChangesSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: SheetNavigation,
        useValue: { dismiss, leaveTo: jest.fn() },
      },
      {
        provide: BasketStore,
        useValue: {
          basket: options.basket ?? signal({ id: 'basket-saturday' }),
          me: signal(options.me ?? ME),
          address: signal({ basketId: 'basket-saturday' }),
        },
      },
      {
        provide: BasketChangeStore,
        useValue: {
          state,
          changes: entries,
          hasMore: signal(options.hasMore ?? false),
          loadingMore: signal(false),
          load,
          loadMore,
        },
      },
      {
        provide: ChangeAcknowledger,
        useValue: { reportSheetEntries },
      },
      provideFakeMemberNames(names),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChangesSheet);
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    load,
    loadMore,
    dismiss,
    reportSheetEntries,
    state,
    entries,
    names,
    /** The entries as the sheet hands them to `lib-change-entry`. */
    views: () =>
      (
        fixture.componentInstance as unknown as {
          entries: () => readonly ChangeEntryView[];
        }
      ).entries(),
  };
}

describe('ChangesSheet', () => {
  it('reads the first page when it opens', async () => {
    const { load } = await render();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads the first page once the basket arrives, on a cold load of the sheet', async () => {
    const basket = signal<{ id: string } | null>(null);
    const { load, fixture } = await render({ basket, state: 'loading' });
    expect(load).not.toHaveBeenCalled();

    basket.set({ id: 'basket-saturday' });
    fixture.detectChanges();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('draws skeletons while the page is on its way', async () => {
    const { host } = await render({ state: 'loading' });

    expect(host.querySelectorAll('.skeleton-entry')).toHaveLength(3);
    expect(host.textContent).toContain('basket.changes.loading');
  });

  it('says so with a retry when the read will not arrive', async () => {
    const { host, load } = await render({ state: 'failed' });

    expect(host.textContent).toContain('basket.changes.failed');
    host.querySelector<HTMLButtonElement>('.secondary')?.click();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says nothing changed rather than drawing an empty list', async () => {
    const { host } = await render({ state: 'ready', entries: [] });

    expect(host.textContent).toContain('basket.changes.empty');
    expect(host.querySelector('.entries')).toBeNull();
  });

  it('draws one entry per change, as a real list', async () => {
    const { host } = await render({
      entries: [change(), change({ id: 'chg-2' })],
    });

    expect(host.querySelectorAll('ul.entries > li')).toHaveLength(2);
    expect(host.querySelectorAll('lib-change-entry')).toHaveLength(2);
  });

  it('opens nothing: an entry is a fact and not a way back to a row', async () => {
    const { host } = await render({ entries: [change()] });

    // The two buttons on the sheet are Close and, when there is one, Show
    // more. No entry is one.
    expect(host.querySelectorAll('.entries button, .entries a')).toHaveLength(
      0
    );
  });

  it('calls the reader “You” on their own change', async () => {
    const { host } = await render({
      entries: [
        change({ actor: { participantId: ME.id, userId: null, name: null } }),
      ],
    });

    expect(host.textContent).toContain('basket.history.you');
  });

  it('names somebody this client can name', async () => {
    const { host } = await render({
      entries: [
        change({ actor: { participantId: 'p-2', userId: null, name: 'Marc' } }),
      ],
    });

    expect(host.textContent).toContain('Marc');
  });

  it('says “Someone” for a person it may not name', async () => {
    // A guest who typed nothing and an account this reader is not entitled to
    // know about are deliberately indistinguishable here.
    const { host } = await render({
      entries: [
        change({ actor: { participantId: null, userId: 'u-9', name: null } }),
      ],
    });

    expect(host.textContent).toContain('basket.history.someone');
  });

  it('names the list only where the reader holds a ref for it', async () => {
    const withList = await render({ entries: [change({ list: LIST })] });
    expect(withList.host.textContent).toContain('basket.changes.entry.inList');

    const guest = await render({ entries: [change({ list: null })] });
    expect(guest.host.textContent).not.toContain('basket.changes.entry.inList');
  });

  it('offers a second page only while there is one', async () => {
    const without = await render({ entries: [change()], hasMore: false });
    expect(
      without.host.querySelector('.secondary')?.textContent
    ).toBeUndefined();

    const withMore = await render({ entries: [change()], hasMore: true });
    expect(withMore.host.querySelector('.secondary')?.textContent).toContain(
      'basket.changes.more'
    );
  });

  it('keeps focus on the button and announces what arrived', async () => {
    const loadMore = jest.fn().mockResolvedValue(4);
    const { fixture, host } = await render({
      entries: [change()],
      hasMore: true,
      loadMore,
    });

    const button = host.querySelector<HTMLButtonElement>('.secondary');
    button?.focus();
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(loadMore).toHaveBeenCalledTimes(1);
    // Focus moved nowhere: somebody reading downwards keeps their place.
    expect(host.ownerDocument.activeElement).toBe(button);
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'basket.changes.loaded'
    );
  });

  it('says so politely when the second page will not load', async () => {
    const { fixture, host } = await render({
      entries: [change()],
      hasMore: true,
      loadMore: jest.fn().mockResolvedValue(null),
    });

    host.querySelector<HTMLButtonElement>('.secondary')?.click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'basket.changes.failed'
    );
    // The page already read is still on screen and still worth reading.
    expect(host.querySelectorAll('lib-change-entry')).toHaveLength(1);
  });

  it('dismisses to the basket underneath', async () => {
    const { host, dismiss } = await render({ entries: [change()] });

    host.querySelector<HTMLButtonElement>('.quiet')?.click();

    expect(dismiss).toHaveBeenCalledWith(
      '/velista/en/shopping-lists/basket-saturday'
    );
  });

  it('tells the acknowledger how many entries it drew, and nothing while loading', async () => {
    const drawn = await render({ entries: [change(), change({ id: 'b' })] });
    expect(drawn.reportSheetEntries).toHaveBeenCalledWith(2);

    const loading = await render({ state: 'loading', entries: [change()] });
    expect(loading.reportSheetEntries).toHaveBeenCalledWith(0);
  });

  it('tells it the sheet has gone, so the page stops acknowledging for it', async () => {
    const { fixture, reportSheetEntries } = await render({
      entries: [change()],
    });
    reportSheetEntries.mockClear();

    fixture.destroy();

    expect(reportSheetEntries).toHaveBeenCalledWith(0);
  });

  it('wears the server’s tag, and computes nothing from the date', async () => {
    const { host } = await render({
      entries: [
        change({ id: 'new', unseen: true }),
        change({ id: 'old', unseen: false }),
      ],
    });

    // One of two, although both carry the same `at`: the flag is the server's.
    expect(host.querySelectorAll('.tag')).toHaveLength(1);
  });
});

/**
 * Where a buy came from (velista `0142`, section 4). One line replaces who and
 * which list, and it names a person from the basket or from the zone members
 * the app holds, never the other shopping list.
 */
describe('ChangesSheet: a buy made outside this shopping list (velista 0142)', () => {
  const owner = (userId: string | null) => ({
    kind: 'ANOTHER_BASKET' as const,
    owner: userId === null ? null : { participantId: null, userId, name: null },
  });
  const buy = (over: Partial<BasketChange> = {}) =>
    change({
      kind: 'BOUGHT',
      contentBefore: null,
      contentAfter: null,
      rowContent: 'Milk',
      quantityBefore: 2,
      quantityAfter: 0,
      list: LIST,
      ...over,
    });

  it('names the owner of the other shopping list from the zone members', async () => {
    const { views, names } = await render({
      entries: [buy({ origin: owner('u-ana') })],
      members: { 'u-ana': 'Ana' },
    });

    expect(views()[0]).toMatchObject({
      key: 'basket.changes.entry.boughtAll',
      origin: {
        key: 'basket.changes.origin.anotherBasket',
        args: { name: 'Ana' },
      },
      who: '',
      list: '',
    });
    expect(names.asked).toEqual([LIST.zoneId]);
  });

  it('tells the reader the other shopping list is one of theirs', async () => {
    const { views } = await render({
      entries: [buy({ origin: owner('u-me') })],
    });

    expect(views()[0].origin?.key).toBe(
      'basket.changes.origin.anotherBasketYours'
    );
  });

  it('says someone for an owner nobody can name', async () => {
    const { views } = await render({
      entries: [buy({ origin: owner('u-stranger') })],
    });

    expect(views()[0].origin?.key).toBe(
      'basket.changes.origin.anotherBasketSomeone'
    );
  });

  it('names who bought it on the list page, and calls the reader you', async () => {
    const { views } = await render({
      entries: [
        buy({
          id: 'a',
          origin: { kind: 'LIST' },
          actor: { participantId: null, userId: 'u-ana', name: null },
        }),
        buy({
          id: 'b',
          origin: { kind: 'LIST' },
          actor: { participantId: null, userId: 'u-me', name: null },
        }),
      ],
      members: { 'u-ana': 'Ana' },
    });

    expect(views().map((view) => view.origin)).toEqual([
      { key: 'basket.changes.origin.list', args: { name: 'Ana' } },
      { key: 'basket.changes.origin.listYou', args: {} },
    ]);
  });

  it('tells a guest someone, and asks for no members', async () => {
    const guest: BasketParticipant = {
      ...ME,
      id: 'p-guest',
      kind: 'GUEST',
      username: null,
      userId: null,
    };
    const { views, names, host } = await render({
      me: guest,
      entries: [
        buy({ origin: owner(null), list: null }),
        buy({ id: 'b', origin: { kind: 'LIST' }, actor: null, list: null }),
      ],
    });

    expect(views().map((view) => view.origin?.key)).toEqual([
      'basket.changes.origin.anotherBasketSomeone',
      'basket.changes.origin.listSomeone',
    ]);
    expect(names.asked).toEqual([]);
    expect(host.textContent).not.toContain('basket.changes.entry.inList');
  });

  it('names an account that is not on this shopping list from the zone members too', async () => {
    const { views, names } = await render({
      entries: [
        change({
          kind: 'ADDED',
          list: LIST,
          actor: { participantId: null, userId: 'u-ana', name: null },
        }),
      ],
      members: { 'u-ana': 'Ana' },
    });

    expect(views()[0].who).toBe('Ana');
    expect(names.asked).toEqual([LIST.zoneId]);
  });

  it('keeps who for a buy of this shopping list, and names no list', async () => {
    const { views } = await render({
      entries: [
        buy({
          origin: null,
          actor: { participantId: 'p-2', userId: null, name: 'Marc' },
        }),
      ],
    });

    expect(views()[0]).toMatchObject({ who: 'Marc', list: '', origin: null });
  });
});
