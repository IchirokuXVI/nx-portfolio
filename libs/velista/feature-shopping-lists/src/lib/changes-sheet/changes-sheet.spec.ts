import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketChangeStore, BasketStore } from '@portfolio/velista/data-access';
import type {
  BasketChange,
  BasketListRef,
  BasketParticipant,
} from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
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
          me: signal(ME),
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
  };
}

describe('ChangesSheet', () => {
  it('reads the first page when it opens', async () => {
    const { load } = await render();

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
    expect(guest.host.textContent).not.toContain(
      'basket.changes.entry.inList'
    );
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

    expect(dismiss).toHaveBeenCalledWith('/velista/en/shopping-lists/basket-saturday');
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
