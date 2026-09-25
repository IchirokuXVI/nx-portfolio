import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeBasketListStore,
  GatewayError,
  provideFakeBasketListStore,
  type FakeBasketListStore,
} from '@portfolio/velista/data-access';
import { type BasketSummary } from '@portfolio/velista/models';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { BasketCurrentPage } from './basket-current';

/**
 * What the third tab opens (velista `0097`, section 7).
 *
 * The store is handed to the page already in the state under test, which is what the
 * history's spec does and for the same reason: every test below changes one thing about
 * the world and asserts on what is drawn, or on where the app went.
 */

/**
 * Somewhere for the redirect to land. Without it every navigation this page makes
 * rejects with `NG04002`, which is a failure about the fixture rather than about the
 * screen.
 */
@Component({ selector: 'lib-test-page', template: '' })
class TestPage {}

function basket(overrides: Partial<BasketSummary> = {}) {
  return {
    id: 'gl1',
    name: 'Saturday big shop',
    // `OPEN`, which is what a basket somebody is still going to shop is: backend
    // `0133` folded `DRAFT` and `ACTIVE` into one value, and `isOpenBasket` names
    // that one. A fixture still saying `DRAFT` is a basket no filter matches.
    status: 'OPEN',
    generatedAt: new Date('2026-08-21T10:00:00.000Z'),
    lineCount: 12,
    settledLineCount: 4,
    boughtLineCount: 3,
    notAvailableLineCount: 1,
    presentCount: 0,
    ...overrides,
  } as BasketSummary;
}

async function render(
  store: FakeBasketListStore = fakeBasketListStore()
): Promise<ComponentFixture<BasketCurrentPage>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketCurrentPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: TestPage }]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(),
      provideFakeBasketListStore(store),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BasketCurrentPage);
  fixture.detectChanges();
  return fixture;
}

const query = (
  fixture: ComponentFixture<BasketCurrentPage>,
  selector: string
) => (fixture.nativeElement as HTMLElement).querySelector(selector);

const text = (fixture: ComponentFixture<BasketCurrentPage>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('BasketCurrentPage', () => {
  let go: jest.SpyInstance;

  beforeEach(() => {
    go = jest.spyOn(Router.prototype, 'navigateByUrl');
  });

  afterEach(() => go.mockRestore());

  /** The redirects this page sent, which never includes the history's push. */
  const redirects = () =>
    go.mock.calls.filter(([, extras]) => extras?.replaceUrl === true);

  /**
   * With an open generated basket the tab is a doorway: the address bar names the
   * basket, so a reload lands on it rather than here.
   */
  it('goes to the newest open generated basket, replacing its own entry', async () => {
    await render(
      fakeBasketListStore([basket({ id: 'gl2' }), basket({ id: 'gl1' })])
    );

    expect(go).toHaveBeenCalledWith('/en/shopping-lists/gl2', {
      replaceUrl: true,
    });
    expect(redirects()).toHaveLength(1);
  });

  /** With none, the live basket, which every account has (velista `0111`). */
  it('goes to the live basket when there is no generated basket', async () => {
    await render();

    expect(go).toHaveBeenCalledWith('/en/shopping-lists/live', {
      replaceUrl: true,
    });
  });

  // A basket that is over is not one to shop, so it does not answer the tab.
  it('goes to the live basket when every generated basket is finished', async () => {
    await render(fakeBasketListStore([basket({ status: 'FINISHED' })]));

    expect(go).toHaveBeenCalledWith('/en/shopping-lists/live', {
      replaceUrl: true,
    });
  });

  /**
   * `replaceUrl` is the whole of the back button working: pushed instead, back from
   * the basket would land here and be sent forward again.
   */
  it('never pushes an entry of its own', async () => {
    await render(fakeBasketListStore([basket()]));

    expect(
      go.mock.calls.every(([, extras]) => extras?.replaceUrl === true)
    ).toBe(true);
  });

  it('draws no empty state', async () => {
    const fixture = await render();

    expect(text(fixture)).not.toContain('basket.current.empty');
    expect(query(fixture, '.primary')).toBeNull();
  });

  describe('while the listing is on its way', () => {
    it('shows the loading state and goes nowhere yet', async () => {
      const fixture = await render(
        fakeBasketListStore([], { state: 'loading' })
      );

      expect(query(fixture, 'lib-row-skeleton')).not.toBeNull();
      expect(redirects()).toHaveLength(0);
    });

    it('goes once the listing answers', async () => {
      const store = fakeBasketListStore([], { state: 'loading' });
      const fixture = await render(store);

      store.set([basket({ id: 'gl3' })]);
      store.setState('loaded');
      fixture.detectChanges();
      TestBed.tick();

      expect(go).toHaveBeenCalledWith('/en/shopping-lists/gl3', {
        replaceUrl: true,
      });
      expect(redirects()).toHaveLength(1);
    });

    it('keeps the history one press away', async () => {
      const fixture = await render(
        fakeBasketListStore([], { state: 'loading' })
      );

      (query(fixture, '.bar .history') as HTMLButtonElement).click();

      expect(go).toHaveBeenCalledWith('/en/shopping-lists');
    });
  });

  /**
   * A failed read is not a reason to draw an error: the listing only decides which
   * basket to open, and the live basket needs no listing (velista `0111`).
   */
  describe('when the listing fails', () => {
    it('goes to the live basket rather than drawing an error', async () => {
      const fixture = await render(
        fakeBasketListStore([], {
          state: 'failed',
          error: new GatewayError(500, 'boom', 'cid-1'),
        })
      );

      expect(query(fixture, 'lib-error-state')).toBeNull();
      // The failure was held from an earlier read, so it reads again first.
      fixture.detectChanges();
      TestBed.tick();
      expect(go).toHaveBeenCalledWith('/en/shopping-lists/live', {
        replaceUrl: true,
      });
    });

    it('reads a failed listing again rather than trusting it', async () => {
      const store = fakeBasketListStore([], { state: 'failed' });
      await render(store);

      expect(store.calls).toContain('reload');
    });
  });
});
