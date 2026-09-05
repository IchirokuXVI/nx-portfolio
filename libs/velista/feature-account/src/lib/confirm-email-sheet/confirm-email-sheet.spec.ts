import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  fakeProfileStore,
  profileFor,
  provideFakeAuthService,
  provideFakeProfileStore,
  provideFakeSessionStore,
  type FakeAuthService,
  type FakeProfileStore,
  type ResendOutcome,
} from '@portfolio/velista/data-access';
import type { UserProfile } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { ConfirmEmailSheet } from './confirm-email-sheet';

interface Options {
  /** The profile as held before this sheet is created. Unconfirmed by default. */
  readonly profile?: UserProfile | null;
  /** How the server answers the ask. */
  readonly resend?: ResendOutcome;
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<ConfirmEmailSheet>;
  auth: FakeAuthService;
  profile: FakeProfileStore;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const held =
    options.profile === undefined
      ? profileFor({ email: 'marta@example.com', emailVerified: false })
      : options.profile;

  const profile = fakeProfileStore({
    profile: held,
    state: held === null ? 'loading' : 'loaded',
  });
  const auth = fakeAuthService({ resend: options.resend });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [ConfirmEmailSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeProfileStore(profile),
      provideFakeAuthService(auth),
      provideFakeSessionStore('REGISTERED'),
      { provide: SheetNavigation, useValue: sheets },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConfirmEmailSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, auth, profile, sheets };
}

function text(fixture: ComponentFixture<ConfirmEmailSheet>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function resendButton(
  fixture: ComponentFixture<ConfirmEmailSheet>
): HTMLButtonElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    'lib-resend-sentence button'
  );
}

describe('ConfirmEmailSheet', () => {
  describe('an unconfirmed address', () => {
    it('names the address it is about', async () => {
      const { fixture } = await render();

      expect(text(fixture)).toContain('account.email.confirm.body');
      expect(fixture.componentInstance.email()).toBe('marta@example.com');
    });

    it('offers another send, which is the whole reason this screen exists', async () => {
      const { fixture } = await render();

      expect(resendButton(fixture)).not.toBeNull();
    });

    it('asks the server when the offer is taken', async () => {
      const { fixture, auth } = await render();

      resendButton(fixture)?.click();
      await fixture.whenStable();

      expect(auth.calls).toEqual([{ method: 'resendVerification' }]);
    });

    it('reports the send with the wait the server named, never one of its own', async () => {
      // Rule C3. The bucket is one per minute and how much of it is left is the
      // server's to say: the same sentence is drawn on two other screens, so an ask
      // made on one of those may already have spent this window.
      const { fixture } = await render({
        resend: { state: 'sent', waitSeconds: 37 },
      });

      resendButton(fixture)?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      // On the inputs and not the rendered text: the testing translator returns keys
      // and does not interpolate, so the clock is asserted where it is decided.
      expect(fixture.componentInstance.resendState()).toBe('sent');
      expect(fixture.componentInstance.resendWait()).toBe(37);
      expect(text(fixture)).toContain('auth.resend.sent');
    });

    it('renders a refusal as an outcome rather than a failure', async () => {
      const { fixture } = await render({
        resend: { state: 'refused', waitSeconds: 45 },
      });

      resendButton(fixture)?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.resendState()).toBe('refused');
      expect(text(fixture)).toContain('auth.resend.refused');
    });

    it('claims nothing when the ask never reached the server', async () => {
      // Staying on Ready is the only useful offer for a send that may or may not have
      // happened. Saying it was sent would be a claim; saying it was refused would
      // start a countdown to a moment that means nothing.
      const { fixture } = await render({
        resend: { state: 'failed', error: new Error('offline') },
      });

      resendButton(fixture)?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.resendState()).toBe('ready');
      expect(resendButton(fixture)).not.toBeNull();
    });
  });

  describe('an address that is already confirmed', () => {
    it('says so and offers no send', async () => {
      // Reachable two ways: the link opened in another tab while this was up, and a
      // cold arrival at this URL on an account that never needed it.
      const { fixture } = await render({ profile: profileFor() });

      expect(text(fixture)).toContain('account.email.confirm.already');
      expect(resendButton(fixture)).toBeNull();
    });
  });

  describe('a cold arrival, before the profile has landed', () => {
    it('reads the profile itself rather than assuming a page did', async () => {
      const { profile } = await render({ profile: null });

      expect(profile.calls).toContainEqual({ method: 'load' });
    });

    it('draws no sentence with a blank where the address should be', async () => {
      const { fixture } = await render({ profile: null });

      expect(text(fixture)).toContain('account.email.loading');
      expect(text(fixture)).not.toContain('account.email.confirm.body');
      expect(resendButton(fixture)).toBeNull();
    });

    it('makes no request when a profile is already held', async () => {
      const { profile } = await render();

      expect(profile.calls).not.toContainEqual({ method: 'load' });
    });
  });

  describe('leaving', () => {
    it('goes back to the account screen, and names it as the fallback', async () => {
      const { fixture, sheets } = await render();

      await fixture.componentInstance.dismiss();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/account');
    });
  });
});
