import { EXISTING_USER_IDS_MAX } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { ReconciliationController } from './reconciliation.controller';

/**
 * `auth.existingUserIds` (plan 0232, section 7). The query itself runs against
 * real Postgres in `account-deletion.integration.spec.ts`.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const OPERATOR = '44444444-4444-4444-8444-444444444444';

/**
 * A fake that answers `users` rows always, and `admin_users` rows only to a
 * query that names that table, so the operator case proves the statement asks
 * there and not only that the fake agrees with itself.
 */
function build(existing: string[], operators: string[] = []) {
  const query = jest.fn(async (sql: string, [ids]: [string[]]) =>
    ids
      .filter(
        (id) =>
          existing.includes(id) ||
          (sql.includes('"admin_users"') && operators.includes(id))
      )
      .map((id) => ({ id }))
  );
  return {
    controller: new ReconciliationController({ query } as never),
    query,
  };
}

describe('ReconciliationController.existingUserIds', () => {
  it('answers the ids that are still accounts, in the order asked', async () => {
    const { controller } = build([A, B]);

    await expect(
      controller.existingUserIds({
        userIds: [B, '33333333-3333-4333-8333-333333333333', A],
      })
    ).resolves.toEqual({ userIds: [B, A] });
  });

  it('answers an operator id as known, so its rows in core are not unlinked', async () => {
    const { controller } = build([A], [OPERATOR]);

    await expect(
      controller.existingUserIds({
        userIds: [OPERATOR, A, '33333333-3333-4333-8333-333333333333'],
      })
    ).resolves.toEqual({ userIds: [OPERATOR, A] });
  });

  it('never hands Postgres an id that is not a uuid', async () => {
    const { controller, query } = build([A]);

    await expect(
      controller.existingUserIds({ userIds: ['not-a-uuid', A.toUpperCase()] })
    ).resolves.toEqual({ userIds: [A] });
    expect(query.mock.calls[0][1]).toEqual([[A]]);
  });

  it('asks nothing when no id could be an account', async () => {
    const { controller, query } = build([]);

    await expect(
      controller.existingUserIds({ userIds: ['x', ''] })
    ).resolves.toEqual({ userIds: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses more than the most one request may carry', async () => {
    const { controller, query } = build([]);
    const userIds = Array.from({ length: EXISTING_USER_IDS_MAX + 1 }, () => A);

    await expect(controller.existingUserIds({ userIds })).rejects.toThrow(
      ValidationException
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a payload with no list', async () => {
    const { controller } = build([]);

    await expect(
      controller.existingUserIds({} as never)
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
