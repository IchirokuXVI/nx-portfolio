import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { AccountNotice } from '@portfolio/velista/data-access';
import { APP_KEY } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { LandingPage } from './landing-page';

/**
 * A `RokuLocaleStore` that records what it was asked to switch to.
 *
 * The switch itself is the localization library's behaviour and is covered by its own
 * spec. What is asserted here is the **wiring**, because the wiring is what was
 * missing: the header's language control emitted an event nothing acted on, so
 * clicking it did nothing at all (plan 0007, section 6.2).
 */
function fakeLocaleStore(initial = 'en') {
  return {
    locale: signal(initial),
    switches: [] as readonly (readonly [string, string])[],
    async switchAppLocale(appKey: string, locale: string): Promise<void> {
      this.switches = [...this.switches, [appKey, locale] as const];
      this.locale.set(locale);
    },
  };
}

type FakeLocaleStore = ReturnType<typeof fakeLocaleStore>;

interface Options {
  readonly locale?: string;
  /** What the parent route's data carries, which is where the switcher reads it. */
  readonly supportedLocales?: readonly string[] | undefined;
  /** Whether the page is mounted under a parent route at all. */
  readonly withParent?: boolean;
  /**
   * Whether an account was just deleted, which is the one piece of news this screen
   * reports (plan 0015, section 5.7).
   */
  readonly accountDeleted?: boolean;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LandingPage>;
  store: FakeLocaleStore;
  router: { navigate: jest.Mock };
  notice: AccountNotice;
}> {
  TestBed.resetTestingModule();

  const store = fakeLocaleStore(options.locale ?? 'en');
  const parent = {
    snapshot: {
      data: { supportedLocales: options.supportedLocales ?? ['en', 'es'] },
    },
  };

  // A double rather than `provideRouter([])`, because what is being asserted is the
  // destination this page asks for, not what the router does with it. The real table
  // lives in `feature-shell`, which this library must not import, so a real router
  // here could only be given an empty table and would answer "no route matched".
  const router = { navigate: jest.fn().mockResolvedValue(true) };

  await TestBed.configureTestingModule({
    imports: [LandingPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      // The real `AccountNotice` rather than a double, matching `provideAccountNotice`:
      // it is one signal and two setters with no dependencies, so faking it would mean
      // writing the same object twice and would let a spec pass against behaviour the
      // app does not have.
      AccountNotice,
      { provide: RokuLocaleStore, useValue: store },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: { parent: options.withParent === false ? null : parent },
      },
    ],
  }).compileComponents();

  const notice = TestBed.inject(AccountNotice);
  if (options.accountDeleted === true) {
    // Set before the component is created, which is when it reads and consumes it.
    notice.setDeleted();
  }

  const fixture = TestBed.createComponent(LandingPage);
  fixture.detectChanges();

  return { fixture, store, router, notice };
}

function query(fixture: ComponentFixture<LandingPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function queryAll(fixture: ComponentFixture<LandingPage>, selector: string) {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll(selector)
  );
}

describe('LandingPage', () => {
  describe('what the front door offers', () => {
    it('shows the hero and the illustrative list, and no dashboard chrome', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-home-hero')).not.toBeNull();
      expect(query(fixture, 'lib-list-preview-card')).not.toBeNull();
      expect(query(fixture, 'lib-bottom-action-bar')).toBeNull();
    });

    it('offers exactly four ways in', async () => {
      const { fixture } = await render();

      expect(queryAll(fixture, 'lib-auth-actions button')).toHaveLength(4);
    });

    it('shows the locale switch rather than the account button', async () => {
      // Somebody who has not signed in may well be on the wrong language, and has
      // nothing else to do in the header.
      const { fixture } = await render();

      expect(query(fixture, 'lib-app-bar .locale')).not.toBeNull();
      expect(query(fixture, 'lib-app-bar .avatar')).toBeNull();
    });

    it('hides the illustrative list from assistive technology', async () => {
      // Three invented groceries read out before the two buttons that matter is
      // noise; the hero already says what the product does in words.
      const { fixture } = await render();

      expect(
        query(fixture, 'lib-list-preview-card [aria-hidden="true"]')
      ).not.toBeNull();
    });
  });

  describe('the language control', () => {
    it('labels itself with the locale actually in use', async () => {
      // It used to read `EN` on `/velista/es`, because `AppBar.locale` defaulted to
      // that string and no template ever bound it.
      const { fixture } = await render({ locale: 'es' });

      expect(query(fixture, 'lib-app-bar .locale')?.textContent).toContain(
        'ES'
      );
    });

    it('switches the app locale under this app key when one is picked', async () => {
      const { fixture, store } = await render({ locale: 'en' });

      (query(fixture, 'lib-app-bar .locale') as HTMLButtonElement).click();
      fixture.detectChanges();

      const spanish = queryAll(
        fixture,
        'lib-app-bar .menu-item'
      )[1] as HTMLButtonElement;
      spanish.click();
      fixture.detectChanges();

      expect(store.switches).toEqual([[APP_KEY, 'es']]);
    });

    it('offers the locales the parent route says are usable', async () => {
      // Read from route data rather than from `APP_USABLE_LOCALES`, which lives in
      // feature-shell: importing it back would close a cycle in the project graph.
      const { fixture } = await render({ supportedLocales: ['en'] });

      expect(fixture.componentInstance.locales).toEqual(['en']);
    });

    it('offers nothing rather than crashing when no parent carries the list', async () => {
      const { fixture } = await render({ withParent: false });

      expect(fixture.componentInstance.locales).toEqual([]);
    });
  });

  describe('the preview lines', () => {
    it('asks for a translated string per line', async () => {
      // The testing translator returns the key, so this asserts *which* keys the card
      // is fed rather than copy a translator is free to change. They render as the
      // keys themselves until rokutranslator 0004 and velista 0006 have merged, which
      // plan 0007 section 8 says is the expected result until then.
      const { fixture } = await render();

      expect(
        fixture.componentInstance.previewLines().map((line) => line.content)
      ).toEqual([
        'home.preview.line.milk.content',
        'home.preview.line.bread.content',
        'home.preview.line.tomatoes.content',
      ]);
    });

    it('re-runs on a language switch, so the card does not keep the old groceries', async () => {
      const { fixture, store } = await render({ locale: 'en' });
      const before = fixture.componentInstance.previewLines();

      store.locale.set('es');

      expect(fixture.componentInstance.previewLines()).not.toBe(before);
    });

    it('leaves the initials alone, because a letter is not translatable', async () => {
      const { fixture } = await render();

      expect(
        fixture.componentInstance.previewLines().map((line) => line.by)
      ).toEqual(['A', null, 'M']);
    });
  });

  describe('wiring', () => {
    it('sends the two built entry actions to their sheets', async () => {
      // Relative paths, so neither the locale segment nor the app's mount appears in
      // a page (extraction contract, item 5), and the same two lines are correct in
      // the standalone build.
      const { fixture, router } = await render();

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons[0]?.click();
      buttons[1]?.click();

      expect(router.navigate.mock.calls.map(([commands]) => commands)).toEqual([
        ['sheet', 'zones', 'new'],
        ['sheet', 'zones', 'join'],
      ]);
    });

    it('sends the email action to the sign in screen', async () => {
      // Plan 0009 built it, so this is a navigation rather than a recording. Relative
      // like the two above, and a **sibling** of this page rather than a child:
      // signing in is a destination, not a sheet over the front door.
      const { fixture, router } = await render();

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons[3]?.click();

      expect(router.navigate).toHaveBeenCalledWith(
        ['auth', 'login'],
        expect.anything()
      );
    });

    it('still only records where Google is meant to go', async () => {
      // The one control here that plan 0009 deliberately left unwired, and not for a
      // frontend reason: the gateway's callback answers JSON rather than redirecting
      // into the app, and it never passes `linkUserId` (section 5.6). The recording is
      // what will make connecting it one line.
      const { fixture } = await render();

      const buttons = queryAll(
        fixture,
        'lib-auth-actions button'
      ) as HTMLButtonElement[];
      buttons[2]?.click();

      expect(fixture.componentInstance.pendingRoutes()).toEqual([
        'auth.google',
      ]);
    });

    it('has an outlet for the sheet to render into', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'router-outlet')).not.toBeNull();
    });
  });

  /**
   * Plan 0015, section 5.7. After a delete there is no session, so the dashboard cannot
   * report it and the front door is where the person lands.
   */
  describe('after an account is deleted', () => {
    it('says once that the account is gone', async () => {
      const { fixture } = await render({ accountDeleted: true });

      expect(query(fixture, '.notice')).not.toBeNull();
    });

    it('says nothing on an ordinary visit', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.notice')).toBeNull();
    });

    it('consumes the notice, so a revisit does not repeat it', async () => {
      // The reason it is a one-shot store rather than router state: state survives a
      // reload through the history entry, and coming back to this URL tomorrow is not
      // the moment to be told an account was deleted.
      const { notice } = await render({ accountDeleted: true });

      expect(notice.notice()).toBeNull();
    });
  });
});
