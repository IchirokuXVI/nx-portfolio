import {
  IMPERSONATION_PATTERNS,
  ImpersonationReason,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
import { AdminImpersonationController } from './admin-impersonation.controller';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * The operator's half of a support session (plan 0194).
 *
 * What the gateway adds to auth's answer is the URL, so that is what is
 * asserted: it is built from `APP_BASE_URL`, the code is in the fragment and in
 * no query string, and the raw code is nowhere else in the answer.
 */

const admin: CurrentAdmin = { adminId: 'a1', token: 'admin-token' };
const USER = '33333333-3333-4333-8333-333333333333';

const STARTED = {
  sessionId: 's1',
  code: 'raw-code_-123',
  codeExpiresAt: '2026-10-13T10:01:00.000Z',
  codeTtlMs: 60_000,
  expiresAt: '2026-10-13T12:00:00.000Z',
};

function build(appBaseUrl = 'https://velista.app/{locale}') {
  const send = jest.fn(async (subject: string) =>
    subject === IMPERSONATION_PATTERNS.status ? { enabled: true } : STARTED
  );
  const controller = new AdminImpersonationController(
    { send } as never,
    { getOrThrow: () => ({ appBaseUrl }) } as never
  );
  return { controller, send };
}

describe('the operator half of a support session', () => {
  it('asks auth whether the deployment allows one, with the operator token', async () => {
    const { controller, send } = build();

    await expect(controller.status(admin)).resolves.toEqual({ enabled: true });
    expect(send).toHaveBeenCalledWith(IMPERSONATION_PATTERNS.status, {
      userId: 'a1',
      adminToken: 'admin-token',
    });
  });

  it('starts a session for the user in the path, and forwards the operator token', async () => {
    const { controller, send } = build();

    await controller.start(admin, USER, {
      reason: ImpersonationReason.OTHER,
      note: 'reproducing a report',
    });

    expect(send).toHaveBeenCalledWith(IMPERSONATION_PATTERNS.start, {
      userId: 'a1',
      adminToken: 'admin-token',
      targetUserId: USER,
      reason: ImpersonationReason.OTHER,
      note: 'reproducing a report',
    });
  });

  it('answers a URL with the code in the fragment, and in no query string', async () => {
    const { controller } = build();

    const view = await controller.start(admin, USER, {
      reason: ImpersonationReason.BUG_REPORT,
      locale: 'es',
    });

    expect(view).toEqual({
      sessionId: 's1',
      url: 'https://velista.app/es/auth/impersonate#code=raw-code_-123',
      codeExpiresAt: STARTED.codeExpiresAt,
      // Passed through from auth, so the gateway holds no copy either.
      codeTtlMs: STARTED.codeTtlMs,
      expiresAt: STARTED.expiresAt,
    });
    const url = new URL(view.url);
    expect(url.search).toBe('');
    // The raw code is in the URL and in no other field of the answer.
    expect(Object.keys(view)).not.toContain('code');
  });

  it('builds the URL from APP_BASE_URL and a supported locale, never from what the client sent', async () => {
    const { controller } = build('http://localhost:4200/{locale}/velista');

    const view = await runWithRequestContext({ locale: 'es' } as never, () =>
      controller.start(admin, USER, {
        reason: ImpersonationReason.TESTING,
        locale: 'https://evil.example/',
      })
    );

    // An unsupported locale falls back to the locale of the request.
    expect(view.url).toBe(
      'http://localhost:4200/es/velista/auth/impersonate#code=raw-code_-123'
    );
  });

  it('answers not_configured with no APP_BASE_URL, before a session starts', async () => {
    const { controller, send } = build('');

    await expect(
      controller.start(admin, USER, { reason: ImpersonationReason.TESTING })
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_CONFIGURED });
    expect(send).not.toHaveBeenCalled();
  });
});
