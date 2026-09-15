import { AUTH_USERNAMES_MAX } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { FindOperator } from 'typeorm';
import { fakeAudit } from '../audit/auth-audit.testing';
import type { User } from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * Several accounts' global usernames at once (plan 0114, section 9).
 *
 * The gateway asks this to name people core knows only by id, and every caller
 * has a fallback of its own, so the read answers what it can and never fails
 * for want of a name: an unknown id, or a string that is no id at all, is left
 * out of the answer.
 */

const ONE = '11111111-1111-4111-8111-111111111111';
const TWO = '22222222-2222-4222-8222-222222222222';
const NOBODY = '33333333-3333-4333-8333-333333333333';

function build(users: Partial<User>[]) {
  const find = jest.fn(
    async ({ where }: { where: { id: FindOperator<string[]> } }) =>
      users.filter((user) =>
        (where.id.value as string[]).includes(user.id ?? '')
      )
  );
  const dataSource = { getRepository: jest.fn(() => ({ find })) };
  const service = new IdentityService(
    dataSource as never,
    {} as never,
    new TokenGrantService(),
    {} as never,
    {} as never,
    {} as never,
    new UsernameGenerator(),
    fakeAudit([]).service,
    { getOrThrow: () => ({}) } as never
  );
  return { service, find };
}

describe('auth.getUsernames (plan 0114, section 9)', () => {
  it('answers each known account once, and leaves out ids it does not know', async () => {
    const { service, find } = build([
      { id: ONE, username: 'Brave Otter' },
      { id: TWO, username: 'Quiet Fox' },
    ]);

    const answer = await service.getUsernames({
      userIds: [ONE, TWO, ONE, NOBODY, 'not-an-id'],
    });

    expect(answer).toEqual([
      { userId: ONE, username: 'Brave Otter' },
      { userId: TWO, username: 'Quiet Fox' },
    ]);
    // Asked once, for the distinct ids that could name an account.
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0].where.id.value).toEqual([ONE, TWO, NOBODY]);
  });

  it('asks the database nothing for an empty request', async () => {
    const { service, find } = build([]);

    await expect(service.getUsernames({ userIds: [] })).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it(`refuses more than ${AUTH_USERNAMES_MAX} accounts at once`, async () => {
    const { service, find } = build([]);
    const userIds = Array.from(
      { length: AUTH_USERNAMES_MAX + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );

    await expect(service.getUsernames({ userIds })).rejects.toBeInstanceOf(
      ValidationException
    );
    expect(find).not.toHaveBeenCalled();
  });
});
