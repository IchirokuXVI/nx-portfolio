import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
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
import { SessionWarning } from './session-warning';

/**
 * The idle session's last few minutes (plan 0003, section 3).
 *
 * Small, because the strip has one job: it says the session is ending and it
 * hands anything the operator does to the lifecycle. The timing that decides
 * when it appears is asserted in `session-lifecycle.spec.ts`, where it can be
 * driven by a clock.
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

const service: SessionServiceI = {
  signIn: async () => session,
  signInForDevelopment: async () => session,
  refresh: async () => session,
  readMe: async () => me,
};

async function render() {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SessionWarning, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: SESSION_SERVICE, useValue: service },
      SessionStorage,
      SessionStore,
      SessionLifecycle,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(SessionWarning);
  fixture.detectChanges();
  return { fixture, lifecycle: TestBed.inject(SessionLifecycle) };
}

describe('SessionWarning', () => {
  it('announces itself politely rather than as an error', async () => {
    const { fixture } = await render();
    const host: HTMLElement = fixture.nativeElement;

    // Not `alert`: this is not an error, it has minutes of warning behind it,
    // and announcing it as one interrupts a screen reader mid sentence.
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-live')).toBe('polite');
  });

  /**
   * Dismissing the warning and touching anything are the same act, so the one
   * control here does exactly what a keystroke does. There is deliberately no
   * close button that leaves the session running down with the operator
   * believing they answered it.
   */
  it('has one control, and it keeps the session', async () => {
    const { fixture, lifecycle } = await render();
    const keepAlive = jest.spyOn(lifecycle, 'keepAlive');
    const buttons =
      fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button');

    expect(buttons).toHaveLength(1);

    buttons[0].click();

    expect(keepAlive).toHaveBeenCalled();
    keepAlive.mockRestore();
  });
});
