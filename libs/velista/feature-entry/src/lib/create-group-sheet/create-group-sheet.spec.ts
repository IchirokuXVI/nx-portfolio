import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
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
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { CreateGroupSheet } from './create-group-sheet';

/** Never settles, which is how the submitting state is reached rather than faked. */
const inFlight = () => new Promise<ZoneEntryOutcome>(() => undefined);

interface Options {
  readonly identity?: FakeIdentity;
  readonly returnTo?: 'landing' | 'home';
  readonly respond?: (
    call: ZoneMutationCall
  ) => ZoneEntryOutcome | Promise<ZoneEntryOutcome>;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<CreateGroupSheet>;
  store: FakeZoneStore;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
  tokens: { clear: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const store = fakeZoneStore({ respond: options.respond });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = { clear: jest.fn() };

  await TestBed.configureTestingModule({
    imports: [CreateGroupSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeZoneStore(store),
      provideFakeSessionStore(options.identity ?? 'TEMPORARY'),
      { provide: SheetNavigation, useValue: sheets },
      { provide: TokenStore, useValue: tokens },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { data: { returnTo: options.returnTo ?? 'landing' } },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CreateGroupSheet);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, store, sheets, tokens };
}

function query(fixture: ComponentFixture<CreateGroupSheet>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function type(
  fixture: ComponentFixture<CreateGroupSheet>,
  value: string
): void {
  const field = query(fixture, '.field') as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('CreateGroupSheet', () => {
  describe('before anything is typed', () => {
    it('offers one field and a disabled primary', async () => {
      const { fixture } = await render();

      expect(query(fixture, '.field')).not.toBeNull();
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        true
      );
    });

    it('enables the primary the moment the field is not empty', async () => {
      const { fixture } = await render();

      type(fixture, 'Flat 3B');

      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it('asks for no name for the person, because the backend already has one', async () => {
      // `CreateZoneDto.username` is optional, and omitting it means "call me by my
      // global username" (plan 0008, section 5.2).
      const { fixture } = await render();

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('input')
      ).toHaveLength(1);
    });
  });

  describe('creating', () => {
    it('sends the trimmed name and nothing else', async () => {
      const { fixture, store } = await render();
      type(fixture, '  Flat 3B  ');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(store.mutations).toEqual([
        { method: 'createZone', name: 'Flat 3B' },
      ]);
    });

    it('lands on the dashboard, where the group and its code are waiting', async () => {
      const { fixture, sheets } = await render();
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(sheets.leaveTo).toHaveBeenCalledWith('/velista/en/home');
    });

    it('tells a guest that an account is being made, while it happens', async () => {
      // Told afterwards, it is news about something that already went ahead without
      // asking. The notice is only on screen while the request is in flight.
      const { fixture } = await render({
        identity: 'anonymous',
        respond: inFlight,
      });
      type(fixture, 'Flat 3B');

      expect(query(fixture, '.notice')).toBeNull();

      (query(fixture, '.primary') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query(fixture, '.notice')).not.toBeNull();
    });

    it('says nothing about an account to somebody who already has one', async () => {
      const { fixture } = await render({
        identity: 'REGISTERED',
        respond: inFlight,
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query(fixture, '.notice')).toBeNull();
    });

    it('cannot be dismissed or cancelled once the request has gone', async () => {
      // The write has already left, so offering to back out of it would be a lie.
      const { fixture, sheets } = await render({
        respond: inFlight,
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query(fixture, '.cancel')).toBeNull();
      (query(fixture, '.scrim') as HTMLButtonElement).click();
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    it('keeps the button named while it is busy', async () => {
      // `aria-busy` rather than a label swapped for a spinner alone, so what is
      // happening is announced and not only drawn.
      const { fixture } = await render({
        respond: inFlight,
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      fixture.detectChanges();

      const primary = query(fixture, '.primary') as HTMLButtonElement;
      expect(primary.getAttribute('aria-busy')).toBe('true');
      expect(primary.textContent).toContain('entry.createZone.submitting');
    });
  });

  describe('when it does not work', () => {
    it('blames itself for a join code collision, and stays usable', async () => {
      const { fixture } = await render({
        respond: () => ({
          state: 'failed',
          error: new GatewayError({
            code: 'conflict',
            status: 409,
            correlationId: 'ref',
          }),
        }),
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, '.error')?.textContent).toContain(
        'entry.error.createClash'
      );
      expect((query(fixture, '.primary') as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it('announces the message and hands it to the field', async () => {
      const { fixture } = await render({
        respond: () => ({ state: 'failed', error: new Error('boom') }),
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, '.error') as HTMLElement;
      expect(message.getAttribute('role')).toBe('alert');
      expect(
        (query(fixture, '.field') as HTMLInputElement).getAttribute(
          'aria-describedby'
        )
      ).toBe(message.id);
    });

    it('covers the sheet entirely when the guest account is gone', async () => {
      // Rule D3 refused to send. An inline message would leave the primary offering
      // to make exactly the duplicate account the rule exists to prevent.
      const { fixture, tokens, sheets } = await render({
        respond: () => ({ state: 'guest-account-lost' }),
      });
      type(fixture, 'Flat 3B');

      (query(fixture, '.primary') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'lib-account-lost-panel')).not.toBeNull();
      expect(query(fixture, 'lib-sheet-shell')).toBeNull();

      (query(fixture, '.action') as HTMLButtonElement).click();
      expect(tokens.clear).toHaveBeenCalled();
      expect(sheets.leaveTo).toHaveBeenCalledWith('/velista/en');
    });
  });

  describe('closing', () => {
    it('goes back to the front door when it was opened over it', async () => {
      const { fixture, sheets } = await render({ returnTo: 'landing' });

      (query(fixture, '.cancel') as HTMLButtonElement).click();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en');
    });

    it('goes back to the dashboard when it was opened over that', async () => {
      const { fixture, sheets } = await render({ returnTo: 'home' });

      (query(fixture, '.cancel') as HTMLButtonElement).click();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/home');
    });
  });
});
