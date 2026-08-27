import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeAuthService,
  GatewayError,
  provideAccountNotice,
  provideFakeAuthService,
  provideFakeSessionStore,
  VERIFY_RESEND_AVAILABLE,
  type FakeAuthService,
  type FakeIdentity,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { VerifyEmailPage } from './verify-email-page';

interface Options {
  readonly token?: string | null;
  readonly auth?: FakeAuthService;
  readonly identity?: FakeIdentity;
}

async function render(options: Options = {}) {
  TestBed.resetTestingModule();

  const auth = options.auth ?? fakeAuthService();
  const token = options.token === undefined ? 'good-token' : options.token;

  await TestBed.configureTestingModule({
    imports: [VerifyEmailPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeAuthService(auth),
      provideFakeSessionStore(options.identity ?? 'anonymous'),
      provideAccountNotice(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) => (key === 'token' ? token : null),
            },
          },
        },
      },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

  const fixture = TestBed.createComponent(VerifyEmailPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, auth, router };
}

function query(fixture: ComponentFixture<VerifyEmailPage>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

const badToken = new GatewayError({
  code: 'validation_failed',
  status: 400,
  correlationId: 'c1',
});

describe('VerifyEmailPage', () => {
  describe('arriving', () => {
    /**
     * Section 3.3: the token is consumed on arrival, with no button to press first. A
     * confirm button on a page reached **from** a link that said confirm my email asks
     * the same question twice, and the second ask is the one people abandon.
     */
    it('spends the token on arrival, with nothing to press', async () => {
      const { fixture, auth } = await render({ token: 'abc123' });

      expect(auth.calls).toEqual([{ method: 'verifyEmail', token: 'abc123' }]);
      // The only button on the confirmed screen is the way onward, and it was not
      // needed to get here.
      expect(fixture.componentInstance.state()).toBe('confirmed');
    });

    it('spends it exactly once', async () => {
      const { fixture, auth } = await render();

      fixture.detectChanges();
      await fixture.whenStable();

      expect(auth.calls).toHaveLength(1);
    });

    it('shows the confirmed screen when it worked', async () => {
      const { fixture } = await render();

      expect(query(fixture, 'lib-outcome-screen')).not.toBeNull();
      expect(fixture.componentInstance.state()).toBe('confirmed');
    });
  });

  describe('when the link is spent', () => {
    /**
     * Expired, already used and unknown are one screen, because the server returns one
     * error for all three and cannot tell them apart either.
     */
    it('shows one screen for every way a link can fail', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { verifyEmail: badToken } }),
      });

      expect(fixture.componentInstance.state()).toBe('expired');
    });

    it('treats a link with no token as the same event', async () => {
      // To somebody holding a broken link the two are the same thing, and a
      // "malformed link" screen would explain a distinction only a developer cares
      // about.
      const { fixture, auth } = await render({ token: null });

      expect(fixture.componentInstance.state()).toBe('expired');
      expect(auth.calls).toHaveLength(0);
    });

    it('does not alarm: the account is fine and the way onward is the same', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { verifyEmail: badToken } }),
      });

      // The same single action as the confirmed screen, into the app.
      expect(query(fixture, 'button.primary')).not.toBeNull();
    });
  });

  describe('the resend sentence', () => {
    /**
     * Section 5.8: the endpoint does not exist yet, so the sentence is not rendered
     * anywhere. This spec is written against the flag rather than against `false`, so
     * it keeps meaning something on the day the flag is flipped.
     */
    it('is absent everywhere until the endpoint exists', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { verifyEmail: badToken } }),
        identity: 'REGISTERED',
      });

      expect(fixture.componentInstance.resendOffered()).toBe(
        VERIFY_RESEND_AVAILABLE
      );

      if (!VERIFY_RESEND_AVAILABLE) {
        expect(query(fixture, 'lib-resend-sentence')).toBeNull();
      }
    });

    /**
     * Section 5.7: resending needs to know whose address to send to, and somebody who
     * opened the link on a phone that never signed in cannot say. This holds whatever
     * the flag is doing, which is why it is asserted on its own.
     */
    it('is absent for an anonymous viewer, whatever the endpoint is doing', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({ rejectWith: { verifyEmail: badToken } }),
        identity: 'anonymous',
      });

      expect(fixture.componentInstance.resendOffered()).toBe(false);
      expect(query(fixture, 'lib-resend-sentence')).toBeNull();
    });

    it('renders the wait the server returned, never a number of its own', async () => {
      // Rule C3, driven through the page's own handler because the sentence is not on
      // screen yet. The refusal's wait is minutes rather than the minute a hardcoded
      // countdown could show.
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: { verifyEmail: badToken },
          resend: { state: 'refused', waitSeconds: 451 },
        }),
      });

      await fixture.componentInstance.resend();

      expect(fixture.componentInstance.resendState()).toBe('refused');
      expect(fixture.componentInstance.resendWaitSeconds()).toBe(451);
    });

    it('claims nothing when the send itself failed', async () => {
      const { fixture } = await render({
        auth: fakeAuthService({
          rejectWith: { verifyEmail: badToken },
          resend: { state: 'failed', error: new Error('boom') },
        }),
      });

      await fixture.componentInstance.resend();

      // Still Ready, so the person can try again, which is the only useful offer for
      // a send that may not have happened.
      expect(fixture.componentInstance.resendState()).toBe('ready');
      expect(fixture.componentInstance.resendWaitSeconds()).toBeNull();
    });
  });

  describe('the copy', () => {
    it('does not interpolate an empty address into the confirmed sentence', async () => {
      // The link carries only `?token=`, and the token pair carries no email, so this
      // browser usually cannot name the address. A second key says the same thing
      // without claiming to know it.
      const { fixture } = await render();

      expect(fixture.componentInstance.email()).toBeNull();
      expect(fixture.componentInstance.confirmedBodyKey()).toBe(
        'auth.verify.confirmedBodyNoEmail'
      );
    });
  });

  it('sends the one action into the app', async () => {
    const { fixture, router } = await render();

    (query(fixture, 'button.primary') as HTMLButtonElement).click();

    // `authenticatedGuard` is what sends an anonymous visitor on to the front door,
    // so this page does not need to know which of the two the person is.
    expect(router.navigateByUrl).toHaveBeenCalledWith('/en/home');
  });
});
