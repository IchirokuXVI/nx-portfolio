import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeZoneStore,
  GatewayError,
  provideFakeSessionStore,
  provideFakeZoneStore,
  SEED_JOIN_CODES,
  TokenStore,
  ZoneMemory,
  type FakeZoneStore,
  type ZoneEntryOutcome,
  type ZoneMutationCall,
} from '@portfolio/velista/data-access';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { entryErrorKey } from '../entry-error-copy';
import { JoinCodeSheet } from './join-code-sheet';

/** Never settles, which is how the submitting state is reached rather than faked. */
const inFlight = () => new Promise<ZoneEntryOutcome>(() => undefined);

interface Options {
  readonly returnTo?: 'landing' | 'home';
  readonly clipboard?: string;
  readonly respond?: (
    call: ZoneMutationCall
  ) => ZoneEntryOutcome | Promise<ZoneEntryOutcome>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<JoinCodeSheet>;
  store: FakeZoneStore;
  router: { navigateByUrl: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeZoneStore({ respond: options.respond });
  const router = { navigateByUrl: jest.fn().mockResolvedValue(true) };

  await TestBed.configureTestingModule({
    imports: [JoinCodeSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeBrowserFacade(undefined, {
        window: {
          navigator: {
            clipboard: {
              readText: async () => options.clipboard ?? '',
            },
          },
        } as unknown as Window & typeof globalThis,
      }),
      provideFakeZoneStore(store),
      provideFakeSessionStore('TEMPORARY'),
      { provide: Router, useValue: router },
      { provide: TokenStore, useValue: { clear: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { data: { returnTo: options.returnTo ?? 'landing' } },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(JoinCodeSheet);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, store, router };
}

function query(fixture: ComponentFixture<JoinCodeSheet>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function type(fixture: ComponentFixture<JoinCodeSheet>, value: string): void {
  const field = query(fixture, '.field') as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('JoinCodeSheet', () => {
  describe('the code field', () => {
    it('enables the primary at exactly eight characters, and not before', async () => {
      const { fixture } = await render();

      type(fixture, 'HK7M2QP');
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        true
      );

      type(fixture, 'HK7M2QPD');
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it('corrects what somebody typed as they type it', async () => {
      // A code that reaches the gateway lower cased or spaced is a 404 the person
      // cannot act on, and the message they get back says nothing about spaces.
      const { fixture } = await render();

      type(fixture, 'hk7m 2qpd');

      expect((query(fixture, '.field') as HTMLInputElement).value).toBe(
        'HK7M2QPD'
      );
    });

    it('takes the code out of a pasted share link', async () => {
      const { fixture, store } = await render({
        clipboard: 'https://velista.example/velista/en/join/HK7M2QPD',
      });

      (query(fixture, '.paste') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect((query(fixture, '.field') as HTMLInputElement).value).toBe(
        'HK7M2QPD'
      );
      expect(store.mutations).toEqual([]);
    });

    it('tells the person which characters a code never uses', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.hint')?.textContent).toContain(
        'entry.joinZone.hint'
      );
    });
  });

  describe('asking', () => {
    it('sends the code and no username', async () => {
      const { fixture, store } = await render();
      type(fixture, 'HK7M2QPD');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(store.mutations).toEqual([
        { method: 'joinZone', joinCode: 'HK7M2QPD' },
      ]);
    });

    it('lands on the dashboard, where the group is now listed as pending', async () => {
      const { fixture, router } = await render();
      type(fixture, 'HK7M2QPD');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/velista/en/home');
    });

    it('never names the group, because nothing can resolve a code to one', async () => {
      // Section 5.7: `POST /v1/zones/join` is the only route that accepts a code and
      // it joins rather than looks up. A preview would be a promise the sheet cannot
      // keep, so the copy is written to promise only what it can deliver.
      const { fixture } = await render();
      type(fixture, 'HK7M2QPD');

      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
        'Flat 3B'
      );
    });

    it('cannot be dismissed while the ask is in flight', async () => {
      const { fixture, router } = await render({ respond: inFlight });
      type(fixture, 'HK7M2QPD');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query(fixture, '.cancel')).toBeNull();
      (query(fixture, '.scrim') as HTMLButtonElement).click();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('when the code is refused', () => {
    it('says so under the field, and leaves the primary enabled', async () => {
      // A wrong code is one character out far more often than it is nonsense, so the
      // fix is one edit and one tap.
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
      type(fixture, 'HK7M2QPD');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, '.error')?.textContent).toContain(
        'entry.error.noSuchZone'
      );
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
      expect(
        (query(fixture, '.field') as HTMLInputElement).getAttribute(
          'aria-invalid'
        )
      ).toBe('true');
    });
  });

  /**
   * Plan 0008's acceptance criterion: *each row of the section 5.4 table renders its
   * own message, verified against `ZoneMemory` rather than a live gateway.*
   *
   * The whole path is exercised, from a code somebody could type through to the key
   * the sheet would render: the fake throws the same `GatewayError` the interceptor
   * builds, so what is asserted is the mapping the running app uses and not a table
   * copied into a test.
   */
  describe('against the in-memory service', () => {
    let memory: ZoneMemory;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideVelistaTesting(),
          provideFakeBrowserFacade(),
          ZoneMemory,
          {
            // The rule D3 gate, satisfied: what is under test here is the code, not
            // the handshake, which `zone-api.spec.ts` owns.
            provide: TokenStore,
            useValue: {
              authorizeOptionalAuthCall: async () => ({ state: 'authorized' }),
              tokens: () => null,
            },
          },
        ],
      });
      memory = TestBed.inject(ZoneMemory);
    });

    /** What the sheet would render for this code, end to end. */
    async function keyFor(code: string): Promise<string> {
      try {
        await memory.joinZone(code);
        return 'joined';
      } catch (error) {
        return entryErrorKey(error, 'zones.join');
      }
    }

    it('renders one message per row, and a different one each time', async () => {
      const rows = {
        [SEED_JOIN_CODES.joinable]: 'joined',
        [SEED_JOIN_CODES.alreadyIn]: 'entry.error.alreadyAsked',
        [SEED_JOIN_CODES.alreadyAsked]: 'entry.error.alreadyAsked',
        [SEED_JOIN_CODES.banned]: 'entry.error.notAllowed',
        [SEED_JOIN_CODES.rateLimited]: 'entry.error.tooMany',
        NOSUCHXX: 'entry.error.noSuchZone',
      };

      for (const [code, expected] of Object.entries(rows)) {
        // The code is in the assertion so a failure names which row broke.
        expect([code, await keyFor(code)]).toEqual([code, expected]);
      }
    });

    it('reads a code the same way whatever case it was typed in', async () => {
      expect(await keyFor(SEED_JOIN_CODES.banned.toLowerCase())).toBe(
        'entry.error.notAllowed'
      );
    });
  });
});
