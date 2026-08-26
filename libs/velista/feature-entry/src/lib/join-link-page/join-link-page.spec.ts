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
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { JoinLinkPage } from './join-link-page';

interface Options {
  readonly code?: string;
  readonly identity?: FakeIdentity;
  readonly respond?: (
    call: ZoneMutationCall
  ) => ZoneEntryOutcome | Promise<ZoneEntryOutcome>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<JoinLinkPage>;
  store: FakeZoneStore;
  router: { navigateByUrl: jest.Mock };
  tokens: { clear: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeZoneStore({ respond: options.respond });
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
  const tokens = { clear: jest.fn() };

  await TestBed.configureTestingModule({
    imports: [JoinLinkPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
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

  return { fixture, store, router, tokens };
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

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/velista/home');
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
      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/velista');
    });
  });

  describe('declining', () => {
    it('goes to the front door, which is where somebody with no account belongs', async () => {
      const { fixture, router } = await render();

      (query(fixture, '.decline') as HTMLButtonElement).click();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/en/velista');
    });
  });
});
