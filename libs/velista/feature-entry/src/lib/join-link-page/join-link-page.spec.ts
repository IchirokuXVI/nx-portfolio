import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  GatewayError,
  provideFakeSessionStore,
  provideFakeZoneStore,
  TokenStore,
  type FakeIdentity,
  type FakeZoneStore,
  type ZoneEntryOutcome,
  type ZoneMutationCall,
} from '@portfolio/velista/data-access';
import {
  InstallStore,
  provideVelistaTesting,
  type InstallState,
} from '@portfolio/velista/platform';
import { JoinLinkPage } from './join-link-page';

interface Options {
  readonly code?: string;
  readonly identity?: FakeIdentity;
  readonly respond?: (
    call: ZoneMutationCall
  ) => ZoneEntryOutcome | Promise<ZoneEntryOutcome>;
  /** Which mount this copy runs under. `''` is velista's own origin (plan 0033 D5). */
  readonly basePath?: string;
  /** What the browser has said about installing (plan 0033). */
  readonly install?: InstallState;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<JoinLinkPage>;
  store: FakeZoneStore;
  router: { navigateByUrl: jest.Mock };
  tokens: { clear: jest.Mock };
  install: { prompt: jest.Mock };
  order: string[];
}> {
  TestBed.resetTestingModule();

  // What D6 is actually about is the **order** of two calls inside one handler, so the
  // fakes record when each was reached rather than only that it was.
  const order: string[] = [];
  const store = fakeZoneStore({
    respond: (call) => {
      order.push('join');
      return options.respond?.(call) ?? { state: 'joined' };
    },
  });
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  const tokens = { clear: jest.fn() };
  const install = {
    prompt: jest.fn(() => {
      order.push('prompt');
      return Promise.resolve('accepted');
    }),
  };

  await TestBed.configureTestingModule({
    imports: [JoinLinkPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '/velista' }),
      {
        provide: InstallStore,
        useValue: {
          ...install,
          state: signal<InstallState>(options.install ?? 'manual'),
          guide: signal('android-menu'),
          canPrompt: signal(options.install === 'ready'),
        },
      },
      provideFakeZoneStore(store),
      // Anonymous by default, which is the whole point of this page: it is reached
      // from somebody else's message by a person with no account.
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      { provide: Router, useValue: router },
      { provide: TokenStore, useValue: tokens },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({
              code: options.code ?? 'HK7M2QPD',
            }),
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(JoinLinkPage);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, store, router, tokens, install, order };
}

function query(fixture: ComponentFixture<JoinLinkPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

describe('JoinLinkPage', () => {
  describe('arriving cold', () => {
    it('is a page, not a sheet: there is nothing underneath to cover', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-sheet-shell')).toBeNull();
      expect(query(fixture, '.page')).not.toBeNull();
    });

    it('shows the code out of the URL', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.code')?.textContent).toContain('HK7M2QPD');
    });

    it('reads a hand typed link the way the field would', async () => {
      // A link gets retyped often enough to be worth it, and a lower cased code in a
      // URL should not become a 404 with no explanation.
      const { fixture } = await render({ code: 'hk7m2qpd' });

      expect(query(fixture, '.code')?.textContent).toContain('HK7M2QPD');
    });

    it('offers nothing to send when the link carries no usable code', async () => {
      const { fixture } = await render({ code: 'broken' });

      expect(query(fixture, '.primary')).toBeNull();
      expect(query(fixture, '.code-card')).toBeNull();
      // Still a way out, which is the one thing that must always be there.
      expect(query(fixture, '.decline')).not.toBeNull();
    });

    it('says that asking will make an account on this phone', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.notice')?.textContent).toContain(
        'entry.joinLink.guestNotice'
      );
    });

    it('says nothing about an account to somebody who has one', async () => {
      const { fixture } = await render({ identity: 'REGISTERED' });

      expect(query(fixture, '.notice')).toBeNull();
    });

    it('does not claim to know whose group it is', async () => {
      // Section 5.7 again: no endpoint turns a code into a name, so this screen may
      // not say "You are joining Flat 3B" any more than the sheet may.
      const { fixture } = await render();

      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'Flat 3B'
      );
    });
  });

  describe('asking', () => {
    it('sends the code from the link', async () => {
      const { fixture, store } = await render();

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(store.mutations).toEqual([
        { method: 'joinZone', joinCode: 'HK7M2QPD' },
      ]);
    });

    it('lands on the dashboard', async () => {
      const { fixture, router } = await render();

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
    });

    it('renders the same message set, under the card rather than a field', async () => {
      const { fixture } = await render({
        respond: () => ({
          state: 'failed',
          error: new GatewayError({
            code: 'not_found',
            status: 404,
            correlationId: 'ref',
          }),
        }),
      });

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, '.error') as HTMLElement;
      expect(message.textContent).toContain('entry.error.noSuchZone');
      expect(message.getAttribute('role')).toBe('alert');
    });

    it('covers the page when the guest account is gone', async () => {
      const { fixture, tokens, router } = await render({
        respond: () => ({ state: 'guest-account-lost' }),
      });

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'lib-account-lost-panel')).not.toBeNull();

      (query(fixture, '.action') as HTMLButtonElement).click();
      expect(tokens.clear).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en');
    });
  });

  describe('declining', () => {
    it('goes to the front door, which is where somebody with no account belongs', async () => {
      const { fixture, router } = await render();

      (query(fixture, '.decline') as HTMLButtonElement).click();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en');
    });
  });

  /**
   * Install and join (plan 0033 D6). The screen's two forms, which is what section 8
   * asks for: the one that ships today, and the one press that does both things.
   */
  describe('offering the app', () => {
    const READY = { basePath: '', install: 'ready' } as const;

    it('renders exactly what shipped before, when there is no prompt', async () => {
      const { fixture } = await render({ basePath: '', install: 'manual' });

      expect(query(fixture, '.primary')?.textContent).toContain(
        'entry.joinZone.submit'
      );
      expect(query(fixture, '.alternative')).toBeNull();
      // The invite screen does not grow a tutorial. Somebody who wants the app finds
      // it on the account page a minute later.
      expect(query(fixture, 'lib-install-steps')).toBeNull();
    });

    it('offers nothing extra under the shell, even with a prompt in hand', async () => {
      // Rule I5, and D5's second half: somebody mid join is not sent to another origin.
      const { fixture } = await render({
        basePath: '/velista',
        install: 'ready',
      });

      expect(query(fixture, '.alternative')).toBeNull();
      expect(query(fixture, '.primary')?.textContent).toContain(
        'entry.joinZone.submit'
      );
    });

    it('makes the primary do both, with the alternative as a real button', async () => {
      const { fixture } = await render(READY);

      expect(query(fixture, '.primary')?.textContent).toContain(
        'entry.joinLink.installAndJoin'
      );
      // A full alternative and not a quiet link: somebody on a shared or work phone
      // should not have to decline something in order to accept what they came for.
      expect(query(fixture, '.alternative')?.textContent).toContain(
        'entry.joinLink.joinOnly'
      );
      // And Not now stays below both, unchanged.
      expect(query(fixture, '.decline')).not.toBeNull();
    });

    it('prompts first and joins in the same tick', async () => {
      // The order is forced by the platform: `prompt()` needs transient user
      // activation, and awaiting a round trip first spends it.
      const { fixture, order, router } = await render(READY);

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(order).toEqual(['prompt', 'join']);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('still joins when the install dialog is dismissed', async () => {
      // A dismissed install is not a failed join. They are two outcomes, not one.
      const { fixture, install, router } = await render(READY);
      install.prompt.mockResolvedValue('dismissed');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
    });

    it('reports a failed join with the sheet’s own message set', async () => {
      // And a failed join is not a failed install: the error is the existing one,
      // rendered after the dialog closes, on a screen that is still there.
      const { fixture } = await render({
        ...READY,
        respond: () => ({
          state: 'failed',
          error: new GatewayError(404, { detail: 'no such code' }),
        }),
      });

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, '.error')).not.toBeNull();
      expect(query(fixture, '.primary')).not.toBeNull();
    });

    it('joins without prompting when the alternative is pressed', async () => {
      const { fixture, install, order } = await render(READY);

      (query(fixture, '.alternative') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(install.prompt).not.toHaveBeenCalled();
      expect(order).toEqual(['join']);
    });
  });
});
