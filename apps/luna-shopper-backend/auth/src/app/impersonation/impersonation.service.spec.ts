import { ImpersonationReason } from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { ImpersonationService } from './impersonation.service';

/**
 * What a support session refuses before it reads a row (plan 0194).
 *
 * Every case here is decided by the request and the switch alone, so a database
 * that throws on any use proves the refusal came first. What a row decides (a
 * live session, a consumed code, a deadline) is asserted against real Postgres
 * in `impersonation.integration.spec.ts`: a fake can only agree with itself
 * about a `WHERE` clause.
 */

const OPERATOR = '44444444-4444-4444-8444-444444444444';
const credential = { userId: OPERATOR, adminToken: 'token' };

function build(enabled: boolean) {
  const untouched = () => {
    throw new Error('the database was reached');
  };
  const dataSource = {
    getRepository: untouched,
    query: untouched,
    transaction: untouched,
  };
  const gate = { requireAdmin: jest.fn(async () => OPERATOR) };
  const service = new ImpersonationService(
    dataSource as never,
    {} as never,
    gate as never,
    { write: untouched } as never,
    {} as never,
    { getOrThrow: () => ({ impersonation: { enabled } }) } as never
  );
  return { service, gate };
}

describe('a support session, before any row is read', () => {
  describe('with the switch off', () => {
    it('refuses a start with impersonation_disabled', async () => {
      const { service } = build(false);

      await expect(
        service.start({
          ...credential,
          targetUserId: 'u1',
          reason: ImpersonationReason.BUG_REPORT,
        })
      ).rejects.toMatchObject({ code: ERROR_CODES.IMPERSONATION_DISABLED });
    });

    it('refuses an exchange with the one answer every bad code gets', async () => {
      const { service } = build(false);

      await expect(
        service.exchange({ code: 'any-code' })
      ).rejects.toMatchObject({
        code: ERROR_CODES.IMPERSONATION_CODE_INVALID,
      });
    });

    it('says so to the back office', async () => {
      const { service } = build(false);

      await expect(service.status(credential)).resolves.toEqual({
        enabled: false,
      });
    });
  });

  it('verifies the operator before it says anything, the switch included', async () => {
    const { service, gate } = build(true);
    gate.requireAdmin.mockRejectedValueOnce(new Error('not an operator'));

    await expect(service.status(credential)).rejects.toThrow('not an operator');

    gate.requireAdmin.mockRejectedValueOnce(new Error('not an operator'));
    await expect(
      service.start({
        ...credential,
        targetUserId: 'u1',
        reason: ImpersonationReason.TESTING,
      })
    ).rejects.toThrow('not an operator');
  });

  describe('the reason and its note', () => {
    const start = (reason: unknown, note?: string) =>
      build(true).service.start({
        ...credential,
        targetUserId: 'u1',
        reason: reason as ImpersonationReason,
        note,
      });

    it('refuses a reason that is not one of the four', async () => {
      await expect(start('CURIOSITY')).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    });

    it.each([
      ImpersonationReason.BUG_REPORT,
      ImpersonationReason.SUPPORT_REQUEST,
      ImpersonationReason.TESTING,
    ])('refuses a note beside %s', async (reason) => {
      await expect(start(reason, 'a note')).rejects.toMatchObject({
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    });

    it.each([undefined, '', '   ', 'x'.repeat(501)])(
      'refuses OTHER with a note that is absent, blank or too long (%p)',
      async (note) => {
        await expect(
          start(ImpersonationReason.OTHER, note)
        ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
      }
    );
  });

  it('answers not_impersonating to an end that names no session', async () => {
    const { service } = build(true);

    await expect(service.end({ userId: 'u1' })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_IMPERSONATING,
    });
  });

  it('answers not live to a check that names no session', async () => {
    const { service } = build(true);

    await expect(service.check({ sessionId: '' })).resolves.toEqual({
      live: false,
    });
  });
});
