import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  SESSION_SERVICE,
  SessionLifecycle,
  SessionStorage,
  SessionStore,
  type SessionServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  AdminMe,
  AdminSession,
} from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReauthOverlay } from './reauth-overlay';

/**
 * The re-authentication overlay (plan 0003, sections 5 and 8).
 *
 * Zoneless, so promise chains are drained by hand rather than with `whenStable`,
 * which hangs. The translator double returns the key, so copy is asserted by key
 * and never by rendered sentence: the double does not interpolate, and the body
 * of this overlay names the operator.
 */

const session: AdminSession = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: 'Operations',
  accessToken: 'a.b.c',
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  receivedAt: new Date(),
};

const me: AdminMe = {
  admin: {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    lastLoginAt: null,
  },
  deployment: 'development',
};

const drain = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Sign in, let the token die, and draw the overlay over the wreckage.
 *
 * `reauthFailure` refuses the *second* sign in and not the first, because the
 * first is the one that establishes the session the overlay is covering. A
 * service that refused both would leave nothing signed in and no overlay to
 * assert on.
 */
async function render(reauthFailure?: unknown) {
  let signIns = 0;

  const service: SessionServiceI = {
    signIn: async () => {
      signIns += 1;
      if (signIns > 1 && reauthFailure !== undefined) {
        throw reauthFailure;
      }
      return session;
    },
    signInForDevelopment: async () => session,
    // Refuses, which is what puts the overlay up rather than renewing quietly.
    refresh: async () => {
      throw new GatewayError({
        code: 'unauthorized',
        status: 401,
        correlationId: 'cid',
      });
    },
    readMe: async () => me,
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ReauthOverlay, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      { provide: SESSION_SERVICE, useValue: service },
      SessionStorage,
      SessionStore,
      SessionLifecycle,
    ],
  }).compileComponents();

  const sessions = TestBed.inject(SessionStore);
  const lifecycle = TestBed.inject(SessionLifecycle);

  await sessions.signIn('ops', 'ops');
  await drain();

  // The 401 path, which fails to renew and raises the overlay.
  const held = lifecycle.recover();
  await drain();

  const fixture = TestBed.createComponent(ReauthOverlay);
  fixture.detectChanges();

  return { fixture, sessions, lifecycle, held };
}

const el = <T extends HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string
): T | null => fixture.nativeElement.querySelector(selector);

async function submit(fixture: ComponentFixture<ReauthOverlay>) {
  await fixture.componentInstance.submit();
  await drain();
  fixture.detectChanges();
}

describe('ReauthOverlay', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('asks for a password, and only a password', async () => {
    const { fixture } = await render();

    expect(el(fixture, 'input[type="password"]')).not.toBeNull();
    // No username field: the operator is already known, and offering to change
    // who is signing in would make this a login screen with a covered app behind
    // it rather than a way back into the session that was interrupted.
    expect(el(fixture, 'input[name="username"]')).toBeNull();
    expect(fixture.componentInstance.username()).toBe('ops');
  });

  /** Section 5: on success the app is exactly where it was. */
  it('lets the held request through and comes down on a password', async () => {
    const { fixture, lifecycle, held, sessions } = await render();

    fixture.componentInstance.password.set('ops');
    await submit(fixture);

    await expect(held).resolves.toBe(true);
    expect(lifecycle.locked()).toBe(false);
    expect(sessions.signedIn()).toBe(true);
  });

  it('says what went wrong and clears the field, by key', async () => {
    const { fixture, lifecycle } = await render(
      new GatewayError({
        code: 'account_locked',
        status: 423,
        correlationId: 'cid',
        retryAfterSeconds: 90,
      })
    );

    fixture.componentInstance.password.set('wrong');
    await submit(fixture);

    // Asserted on the component's own view model, because the testing translator
    // does not interpolate and the rendered sentence would carry a raw
    // `{{seconds}}`.
    expect(fixture.componentInstance.message()).toEqual({
      key: 'signIn.error.lockedOutFor',
      args: { seconds: 90 },
    });
    expect(fixture.componentInstance.password()).toBe('');
    expect(lifecycle.locked()).toBe(true);
  });

  /** Section 6.4, and section 7. The one path that loses work. */
  it('fails the held request and leaves for the login screen when abandoned', async () => {
    const { fixture, lifecycle, held, sessions } = await render();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);

    await fixture.componentInstance.signOut();
    await drain();

    await expect(held).resolves.toBe(false);
    expect(lifecycle.locked()).toBe(false);
    expect(sessions.signedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/sign-in');
    navigate.mockRestore();
  });

  describe('focus', () => {
    it('lands in the password field', async () => {
      const { fixture } = await render();

      expect(document.activeElement).toBe(
        el(fixture, 'input[type="password"]')
      );
    });

    /**
     * Otherwise tabbing walks the cursor into the covered form's inputs and a
     * screen reader reads out the content the overlay exists to hide.
     */
    it('wraps from the last control back to the first', async () => {
      const { fixture } = await render();
      const controls = Array.from(
        fixture.nativeElement.querySelectorAll<HTMLElement>('input, button')
      );
      const first = controls[0];
      const last = controls[controls.length - 1];

      last.focus();
      fixture.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      );

      expect(document.activeElement).toBe(first);
    });

    it('wraps backwards from the first control to the last', async () => {
      const { fixture } = await render();
      const controls = Array.from(
        fixture.nativeElement.querySelectorAll<HTMLElement>('input, button')
      );
      const first = controls[0];
      const last = controls[controls.length - 1];

      first.focus();
      fixture.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        })
      );

      expect(document.activeElement).toBe(last);
    });

    /** There is nothing to go back to: the token is gone either way. */
    it('does not let Escape uncover the screen', async () => {
      const { fixture, lifecycle } = await render();

      fixture.nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await drain();

      expect(lifecycle.locked()).toBe(true);
    });
  });

  /**
   * Section 5.1, asserted against the source rather than against a computed
   * style, because jsdom does not apply a component's stylesheet and the thing
   * being protected is a decision somebody could make in a future edit without
   * noticing it was a security decision.
   *
   * A blur reads as obscured while staying legible to a phone camera and
   * trivially removable in devtools, which is the worst combination: it feels
   * safe and is not.
   */
  describe('opacity', () => {
    const source = readFileSync(join(__dirname, 'reauth-overlay.ts'), 'utf8');
    /** The rule that draws the cover itself, which is the one that matters. */
    const cover = source.match(/:host \{[^}]*\}/)?.[0] ?? '';

    it('covers the whole viewport with a flat colour', () => {
      expect(cover).toContain('background: var(--admin-surface)');
      expect(cover).toContain('inset: 0');
    });

    it.each([
      ['a blur', /backdrop-filter|blur\(/],
      ['a translucent colour', /rgba\(|hsla\(|#[0-9a-f]{8}\b/i],
      ['a see through layer', /opacity/],
    ])('never draws the cover with %s', (_case, forbidden) => {
      expect(cover).not.toMatch(forbidden);
    });

    /** Nowhere in the component, not only on the cover. */
    it('never blurs anything at all', () => {
      expect(source).not.toMatch(/backdrop-filter|blur\(/);
    });
  });
});
