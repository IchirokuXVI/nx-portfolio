import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeGeneratedListStore,
  GatewayError,
  provideFakeGeneratedListStore,
  type FakeGeneratedListStore,
} from '@portfolio/velista/data-access';
import type { GeneratedListSummary } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { ErrorState } from '@portfolio/velista/ui';
import { ShoppingListsPage } from './shopping-lists-page';

/**
 * The history (plan 0045, section 3.3).
 *
 * The page is given a store **already** in the state under test rather than a data
 * layer wired up to arrive there, which is what makes every test below a page test: it
 * changes one thing about the world and asserts on the DOM.
 */

function basket(overrides: Partial<GeneratedListSummary> = {}) {
  return {
    id: 'gl1',
    name: 'Saturday big shop',
    status: 'ACTIVE',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 12,
    settledLineCount: 4,
    // A breakdown that accounts for every finished line, so a row draws the sentence
    // rather than the fallback unless a test deliberately breaks the arithmetic.
    boughtLineCount: 3,
    notAvailableLineCount: 1,
    presentCount: 0,
    ...overrides,
  } as GeneratedListSummary;
}

async function render(
  store: FakeGeneratedListStore = fakeGeneratedListStore()
): Promise<ComponentFixture<ShoppingListsPage>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [ShoppingListsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(),
      provideFakeGeneratedListStore(store),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShoppingListsPage);
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<ShoppingListsPage>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

const query = (
  fixture: ComponentFixture<ShoppingListsPage>,
  selector: string
) => (fixture.nativeElement as HTMLElement).querySelector(selector);

const all = (fixture: ComponentFixture<ShoppingListsPage>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelectorAll(selector);

describe('ShoppingListsPage', () => {
  describe('the states', () => {
    it('shows skeleton rows while the listing is on its way', async () => {
      const fixture = await render(
        fakeGeneratedListStore([], { state: 'loading' })
      );

      expect(query(fixture, 'lib-row-skeleton')).not.toBeNull();
      expect(query(fixture, 'lib-shopping-list-row')).toBeNull();
    });

    // Idle counts as loading: the page's constructor starts the read, so idle is the
    // instant before it happens and drawing the empty state there would flash "no
    // shopping lists yet" at somebody who has a hundred.
    it('treats idle as loading rather than as empty', async () => {
      const fixture = await render(
        fakeGeneratedListStore([], { state: 'idle' })
      );

      expect(query(fixture, 'lib-row-skeleton')).not.toBeNull();
      expect(text(fixture)).not.toContain('history.empty.title');
    });

    it('offers one sentence and one action when there is nothing yet', async () => {
      const fixture = await render();

      expect(text(fixture)).toContain('history.empty.title');
      expect(query(fixture, 'lib-empty-state')).not.toBeNull();
      // The only thing that can put anything on this page.
      expect(text(fixture)).toContain('getList.title');
    });

    it('offers a retry with the support reference when the read failed', async () => {
      const fixture = await render(
        fakeGeneratedListStore([], {
          state: 'failed',
          error: new GatewayError({
            code: 'internal',
            status: 500,
            correlationId: 'ref-9',
          }),
        })
      );

      // Read off the panel's input rather than out of the DOM: the testing translator
      // returns the key without interpolating it, so the reference never reaches the
      // rendered sentence whatever the container computed. The input is the boundary
      // that matters, and the panel's own rendering is tested where it lives.
      expect(
        fixture.debugElement
          .query(By.directive(ErrorState))
          ?.componentInstance.correlationId()
      ).toBe('ref-9');
    });

    it('asks the store for the listing when it is created', async () => {
      const store = fakeGeneratedListStore();

      await render(store);

      expect(store.calls).toContain('load');
    });
  });

  describe('the rows', () => {
    it('draws one per trip, in the order the listing gave them', async () => {
      const fixture = await render(
        fakeGeneratedListStore([
          basket({ id: 'a', name: 'Newest' }),
          basket({ id: 'b', name: 'Older', status: 'COMPLETED' }),
        ])
      );

      const rows = all(fixture, 'lib-shopping-list-row');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('Newest');
      expect(rows[1]?.textContent).toContain('Older');
    });

    // Never colour alone (section 7): the word is what says it.
    it('marks an active trip with the word, not only a colour', async () => {
      const fixture = await render(fakeGeneratedListStore([basket()]));

      expect(text(fixture)).toContain('history.status.active');
    });

    // A draft is a trip somebody is still going to make, and it is what a run actually
    // composes: core writes `DRAFT` and never promotes it, so a badge that asked for
    // `ACTIVE` alone was a badge no row could ever earn. Same one line bug as the
    // dashboard card's, and both now ask `isLiveGeneratedList`.
    it('marks a draft too, since that is what a run composes', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket({ status: 'DRAFT' })])
      );

      expect(text(fixture)).toContain('history.status.active');
    });

    it('says nothing about being shopped now on a finished trip', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket({ status: 'COMPLETED' })])
      );

      expect(text(fixture)).not.toContain('history.status.active');
    });

    /**
     * A trip somebody finished, marked and kept (velista `0057`, section 9).
     *
     * **Not hidden.** Hiding is what `ARCHIVED` is for, and the trip finished an
     * hour ago is the one most likely to be opened next, to check what came home.
     * The sweep in luna `0059` section 4 eventually marks a basket nobody finished
     * the same way, and nothing here tells the two apart: the row says the trip is
     * over, which is true either way.
     */
    it('marks a finished trip, and keeps it in the listing', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket({ status: 'COMPLETED' })])
      );

      expect(all(fixture, 'lib-shopping-list-row')).toHaveLength(1);
      expect(text(fixture)).toContain('history.status.finished');
    });

    it('says nothing about being finished on a trip that is still live', async () => {
      const fixture = await render(fakeGeneratedListStore([basket()]));

      expect(text(fixture)).not.toContain('history.status.finished');
    });

    /**
     * `UNKNOWN` is this build's fallback for a status it does not recognise, so a
     * badge here would tell somebody their shopping was over because the app could
     * not read a word. It costs a mark, which is the safe direction, and is why the
     * row asks for `COMPLETED` exactly rather than for "not live".
     */
    it('claims nothing at all about a status it cannot read', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket({ status: 'UNKNOWN' })])
      );

      expect(text(fixture)).not.toContain('history.status.finished');
      expect(text(fixture)).not.toContain('history.status.active');
    });

    it('titles an unnamed trip with its date rather than leaving it blank', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket({ name: null })])
      );

      const row = query(fixture, 'lib-shopping-list-row');
      expect(row?.textContent?.trim()).not.toBe('');
      expect(row?.textContent).not.toContain('gl1');
    });
  });

  /**
   * Backend `0050` section 7 keeps deletion in the API and no screen offers it. A
   * history that cannot lose entries is the point of keeping one, so this is asserted
   * rather than merely not implemented: a swipe action added later would otherwise
   * arrive silently.
   */
  describe('what it refuses to offer', () => {
    it('gives no way to delete or archive anything', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket(), basket({ id: 'b' })])
      );

      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain('delete');
      expect(html).not.toContain('archive');
      expect(query(fixture, 'lib-trash-icon')).toBeNull();
    });

    it('gives each row exactly one control, which is opening it', async () => {
      const fixture = await render(fakeGeneratedListStore([basket()]));

      const row = query(fixture, 'lib-shopping-list-row');
      expect(row?.querySelectorAll('button')).toHaveLength(1);
    });
  });

  describe('paging', () => {
    it('draws a skeleton at the bottom while a further page is on its way', async () => {
      const store = fakeGeneratedListStore([basket()]);
      store.setLoadingMore(true);
      const fixture = await render(store);

      expect(query(fixture, 'lib-row-skeleton')).not.toBeNull();
      // And the rows it already has are still there, rather than being replaced.
      expect(query(fixture, 'lib-shopping-list-row')).not.toBeNull();
    });

    it('asks for the next page when the scroller nears the bottom', async () => {
      const store = fakeGeneratedListStore([basket()], { hasMore: true });
      const fixture = await render(store);

      const scroller = query(fixture, '.scroller') as HTMLElement;
      Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
      Object.defineProperty(scroller, 'clientHeight', { value: 800 });
      Object.defineProperty(scroller, 'scrollTop', {
        value: 190,
        writable: true,
      });
      scroller.dispatchEvent(new Event('scroll'));

      expect(store.calls).toContain('loadMore');
    });

    it('leaves it alone while there is still a screenful to read', async () => {
      const store = fakeGeneratedListStore([basket()], { hasMore: true });
      const fixture = await render(store);

      const scroller = query(fixture, '.scroller') as HTMLElement;
      Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
      Object.defineProperty(scroller, 'clientHeight', { value: 300 });
      Object.defineProperty(scroller, 'scrollTop', {
        value: 0,
        writable: true,
      });
      scroller.dispatchEvent(new Event('scroll'));

      expect(store.calls).not.toContain('loadMore');
    });
  });

  describe('where it goes', () => {
    it('opens the basket a row names', async () => {
      const fixture = await render(fakeGeneratedListStore([basket()]));
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      (query(fixture, 'lib-shopping-list-row button') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(
        ['..', 'shopping-lists', 'gl1'],
        expect.anything()
      );
    });

    /**
     * Get shopping list opens over **this** page, not over the dashboard.
     *
     * It used to navigate to `../home/get`, so the sheet arrived with the dashboard
     * drawn underneath and closing it dropped the reader back here: the same sheet,
     * opened over the wrong screen. `['get']` is the child route of this page, which
     * is what keeps the history underneath and its scroll intact.
     */
    it('opens the generation sheet over the history, not over the dashboard', async () => {
      const fixture = await render(fakeGeneratedListStore([basket()]));
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      (query(fixture, 'lib-bottom-action-bar button') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(
        ['sheet', 'get'],
        expect.anything()
      );
    });

    it('offers the same sheet from the empty state', async () => {
      const fixture = await render(fakeGeneratedListStore([]));
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      (query(fixture, 'lib-empty-state button') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(
        ['sheet', 'get'],
        expect.anything()
      );
    });

    it('has an outlet for the sheet to render into', async () => {
      // Rule E1 makes the sheet a child route, and a child route with no outlet to
      // render into is a navigation that changes the URL and draws nothing.
      const fixture = await render(fakeGeneratedListStore([basket()]));

      expect(query(fixture, 'router-outlet')).not.toBeNull();
    });

    it('announces how many rows there are, once, rather than one per row', async () => {
      const fixture = await render(
        fakeGeneratedListStore([basket(), basket({ id: 'b' })])
      );

      const live = all(fixture, '[aria-live]');
      expect(live).toHaveLength(1);
      expect(live[0]?.getAttribute('aria-live')).toBe('polite');
    });

    /**
     * Once per **page of results**, not once per change to the count (plan 0049,
     * section 6).
     *
     * The region used to render the row count straight, so it re-read the whole total
     * every time the count moved, and the count moves on the quiet refetch a flatmate's
     * settle triggers. Somebody standing in a shop heard their entire history
     * re-announced each time anybody bought anything.
     *
     * The two cases are told apart by which of the store's signals moves: rows alone
     * is a quiet refresh, rows plus `pagesLoaded` is a page arriving.
     */
    it('stays silent when a settle refresh changes the listing under it', async () => {
      const store = fakeGeneratedListStore([basket(), basket({ id: 'b' })]);
      const fixture = await render(store);

      const spoken = fixture.componentInstance.announced();
      expect(spoken).not.toBe('');

      // A flatmate settles a line: the first page is re-read and merged, and no new
      // page of results has arrived.
      store.set([basket({ settledLineCount: 5 }), basket({ id: 'b' })]);
      fixture.detectChanges();

      expect(fixture.componentInstance.announced()).toBe(spoken);
    });

    it('speaks again when a further page lands', async () => {
      const store = fakeGeneratedListStore([basket()]);
      const fixture = await render(store);

      store.landPage([basket(), basket({ id: 'b' }), basket({ id: 'c' })]);
      fixture.detectChanges();

      // The count is interpolated, which the testing translator does not do, so what is
      // asserted is that the region was written again rather than what it now says.
      expect(fixture.componentInstance.announced()).toContain(
        'history.announce.loaded'
      );
      expect(store.pagesLoaded()).toBe(2);
    });

    it('says nothing at all before any page has arrived', async () => {
      const fixture = await render(
        fakeGeneratedListStore([], { state: 'loading', pagesLoaded: 0 })
      );

      expect(fixture.componentInstance.announced()).toBe('');
    });
  });

  /**
   * What a finished trip came to (plan 0049, section 2).
   *
   * `0045` shipped "N of M finished" because the summary merged a purchase with a shop
   * that had none of it, and "got" would have claimed a purchase that never happened.
   * Backend `0053` put the breakdown on the summary, so the row can say the mock's
   * sentence — and must still fall back to the vague word wherever the numbers cannot
   * support it.
   */
  describe('what the rows say happened', () => {
    it('says what was got and what was unavailable', async () => {
      const fixture = await render(
        fakeGeneratedListStore([
          basket({
            lineCount: 4,
            settledLineCount: 4,
            boughtLineCount: 3,
            notAvailableLineCount: 1,
          }),
        ])
      );

      expect(text(fixture)).toContain('history.row.got');
      expect(text(fixture)).toContain('history.row.unavailable');
      expect(text(fixture)).not.toContain('history.row.progress');
    });

    // "0 not available" is furniture on the ordinary trip where the shop had everything.
    it('drops the unavailable half when there was none', async () => {
      const fixture = await render(
        fakeGeneratedListStore([
          basket({
            lineCount: 4,
            settledLineCount: 3,
            boughtLineCount: 3,
            notAvailableLineCount: 0,
          }),
        ])
      );

      expect(text(fixture)).toContain('history.row.got');
      expect(text(fixture)).not.toContain('history.row.unavailable');
    });

    /**
     * A server older than backend `0053` sends neither count, so they map to zero and
     * fail to account for the finished lines. The row says "finished", which is what
     * `0045` shipped and is still true; saying "0 of 4 got" over three purchases would
     * not be.
     */
    it('says finished where the breakdown cannot account for the finished lines', async () => {
      const fixture = await render(
        fakeGeneratedListStore([
          basket({
            lineCount: 4,
            settledLineCount: 3,
            boughtLineCount: 0,
            notAvailableLineCount: 0,
          }),
        ])
      );

      expect(text(fixture)).toContain('history.row.progress');
      expect(text(fixture)).not.toContain('history.row.got');
    });
  });
});
