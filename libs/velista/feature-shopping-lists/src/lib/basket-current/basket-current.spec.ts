import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeGeneratedListStore,
  GatewayError,
  provideFakeGeneratedListStore,
  type FakeGeneratedListStore,
} from '@portfolio/velista/data-access';
import { type GeneratedListSummary } from '@portfolio/velista/models';
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

function basket(overrides: Partial<GeneratedListSummary> = {}) {
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
  } as GeneratedListSummary;
}

async function render(
  store: FakeGeneratedListStore = fakeGeneratedListStore()
): Promise<ComponentFixture<BasketCurrentPage>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BasketCurrentPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: TestPage }]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(),
      provideFakeGeneratedListStore(store),
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
  /**
   * With a basket being shopped the tab is a doorway and not a screen: the address bar
   * names the basket, so a reload lands on it rather than here.
   */
  it('goes to the live basket, replacing its own entry', async () => {
    const go = jest.spyOn(Router.prototype, 'navigateByUrl');
    await render(fakeGeneratedListStore([basket()]));

    expect(go).toHaveBeenCalledWith('/en/shopping-lists/gl1', {
      replaceUrl: true,
    });

    go.mockRestore();
  });

  /**
   * `replaceUrl` is the whole of the back button working: pushed instead, back from the
   * basket would land here and be sent forward again.
   */
  it('never pushes an entry of its own', async () => {
    const go = jest.spyOn(Router.prototype, 'navigateByUrl');
    await render(fakeGeneratedListStore([basket()]));

    expect(
      go.mock.calls.every(([, extras]) => extras?.replaceUrl === true)
    ).toBe(true);

    go.mockRestore();
  });

  // A basket that is over is not one to shop, so it does not answer the tab.
  it('stays on the empty state for a finished basket', async () => {
    const go = jest.spyOn(Router.prototype, 'navigateByUrl');
    const fixture = await render(
      fakeGeneratedListStore([basket({ status: 'COMPLETED' })])
    );

    expect(go).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('basket.current.empty.title');

    go.mockRestore();
  });

  describe('with no basket', () => {
    it('draws the empty state and both of its actions', async () => {
      const fixture = await render();

      expect(text(fixture)).toContain('basket.current.empty.title');
      expect(text(fixture)).toContain('basket.current.empty.body');
      expect(query(fixture, '.primary')?.textContent?.trim()).toBe(
        'basket.current.empty.make'
      );
      expect(query(fixture, '.secondary')?.textContent?.trim()).toBe(
        'basket.current.empty.older'
      );
    });

    it('opens the generation sheet over this page', async () => {
      const fixture = await render();
      const go = jest.spyOn(TestBed.inject(Router), 'navigate');

      (query(fixture, '.primary') as HTMLButtonElement).click();

      // Relative and stamped with the sheet marker, so the sheet covers this page and
      // the back gesture dismisses it (rule E1, plan 0008).
      expect(go).toHaveBeenCalledWith(
        ['sheet', 'get'],
        expect.objectContaining({ relativeTo: expect.anything() })
      );
    });

    it('goes to the history from See older lists', async () => {
      const fixture = await render();
      const go = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

      (query(fixture, '.secondary') as HTMLButtonElement).click();

      expect(go).toHaveBeenCalledWith('/en/shopping-lists');
    });
  });

  /**
   * Section 7: the clock that used to sit beside Get shopping list on home is in this
   * screen's header, **in both states**, so the history stays one press from the tab
   * while the listing is still being read.
   */
  describe('the clock in the header', () => {
    it('is there while the listing is on its way', async () => {
      const fixture = await render(
        fakeGeneratedListStore([], { state: 'loading' })
      );

      expect(query(fixture, '.bar .history')).not.toBeNull();
      expect(query(fixture, 'lib-row-skeleton')).not.toBeNull();
    });

    it('is there with no basket at all', async () => {
      const fixture = await render();

      expect(query(fixture, '.bar .history')).not.toBeNull();
    });

    it('opens the history', async () => {
      const fixture = await render();
      const go = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

      (query(fixture, '.bar .history') as HTMLButtonElement).click();

      expect(go).toHaveBeenCalledWith('/en/shopping-lists');
    });
  });

  /**
   * A failed read is not an empty one. Drawing "nothing to shop yet" over a request
   * that never answered tells somebody halfway round a shop that their basket is gone.
   */
  it('says what the history says when the read fails', async () => {
    const fixture = await render(
      fakeGeneratedListStore([], {
        state: 'failed',
        error: new GatewayError(500, 'boom', 'cid-1'),
      })
    );

    expect(query(fixture, 'lib-error-state')).not.toBeNull();
    expect(text(fixture)).not.toContain('basket.current.empty.title');
  });
});
