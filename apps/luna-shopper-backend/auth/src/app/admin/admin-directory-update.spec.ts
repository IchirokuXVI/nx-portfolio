import {
  UserKind,
  UsernamePropagation,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { IdentityService } from '../identity/identity.service';
import { AdminDirectoryService } from './admin-directory.service';
import type { AuthPlatformAdminService } from './platform-admin.service';

/**
 * `adminUser.update` (plan 0077, section 3): which write each field goes through,
 * and what an unchanged form costs.
 *
 * The two fields are deliberately not symmetric, and this suite is where that is
 * visible. `username` is handed to `IdentityService`, because the rename has to
 * publish the event core turns into a per zone rename. `displayName` is a column
 * write, because nothing derives from it. Asserting on which collaborator was
 * called is the point: a future refactor that "simplified" the rename into a
 * second column write would pass every assertion about the stored value and fail
 * here.
 */

const NOW = new Date('2026-09-01T10:00:00.000Z');
const ACTOR = 'a1';

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    kind: UserKind.REGISTERED,
    username: 'Swift Sail',
    displayName: 'Alice',
    email: 'a@b.com',
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function build(row: Record<string, unknown> | null = userRow()) {
  const gate = {
    requireAdmin: jest.fn(async () => ACTOR),
  } as unknown as AuthPlatformAdminService;
  const identity = {
    setUsernameAsOperator: jest.fn(async () => undefined),
    setDisplayNameAsOperator: jest.fn(async () => undefined),
  } as unknown as IdentityService;
  const users = { findOne: jest.fn(async () => row) };
  const service = new AdminDirectoryService(
    users as never,
    { countBy: async () => 0 } as never,
    { find: async () => [] } as never,
    { find: async () => [] } as never,
    gate,
    identity
  );
  return {
    service,
    gate: gate as unknown as { requireAdmin: jest.Mock },
    identity: identity as unknown as {
      setUsernameAsOperator: jest.Mock;
      setDisplayNameAsOperator: jest.Mock;
    },
  };
}

describe('AdminDirectoryService.update', () => {
  it('renames through the service and writes the display name as a column', async () => {
    const { service, identity } = build();

    await service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
      username: 'Vela Rápida',
      displayName: 'Alice Cooper',
      usernamePropagation: UsernamePropagation.ALL_ZONES,
    });

    expect(identity.setUsernameAsOperator).toHaveBeenCalledWith(
      'u1',
      'Vela Rápida',
      ACTOR,
      UsernamePropagation.ALL_ZONES
    );
    expect(identity.setDisplayNameAsOperator).toHaveBeenCalledWith(
      'u1',
      'Alice Cooper',
      ACTOR
    );
  });

  it('passes the propagation on untouched, so the service defaults it once', async () => {
    const { service, identity } = build();

    await service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
      username: 'Vela Rápida',
    });

    expect(identity.setUsernameAsOperator).toHaveBeenCalledWith(
      'u1',
      'Vela Rápida',
      ACTOR,
      undefined
    );
  });

  it('makes no write at all for a form saved unchanged, so nothing is recorded', async () => {
    const { service, identity } = build();

    const view = await service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
    });

    // No write means no audit row, which is section 8's rule reached by never
    // opening a transaction rather than by diffing an empty change.
    expect(identity.setUsernameAsOperator).not.toHaveBeenCalled();
    expect(identity.setDisplayNameAsOperator).not.toHaveBeenCalled();
    expect(view.userId).toBe('u1');
  });

  it('tells an absent display name from one that was explicitly cleared', async () => {
    const absent = build();
    await absent.service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
      username: 'Vela Rápida',
    });
    expect(absent.identity.setDisplayNameAsOperator).not.toHaveBeenCalled();

    const cleared = build();
    await cleared.service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
      displayName: null,
    });
    expect(cleared.identity.setDisplayNameAsOperator).toHaveBeenCalledWith(
      'u1',
      null,
      ACTOR
    );
  });

  it('gates once, and every write records the actor the gate returned', async () => {
    const { service, gate, identity } = build();

    await service.update({
      userId: ACTOR,
      adminToken: 't',
      targetUserId: 'u1',
      username: 'Vela Rápida',
      displayName: 'Alice Cooper',
    });

    // Once: reading the answer back must not re-verify a token this call already
    // verified, and both writes must record the id that verification produced.
    expect(gate.requireAdmin).toHaveBeenCalledTimes(1);
    expect(identity.setUsernameAsOperator.mock.calls[0][2]).toBe(ACTOR);
    expect(identity.setDisplayNameAsOperator.mock.calls[0][2]).toBe(ACTOR);
  });

  it('writes nothing when the gate refuses', async () => {
    const { service, gate, identity } = build();
    gate.requireAdmin.mockRejectedValueOnce(
      new ForbiddenException('That operator token was not accepted')
    );

    await expect(
      service.update({
        userId: ACTOR,
        targetUserId: 'u1',
        username: 'Vela Rápida',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(identity.setUsernameAsOperator).not.toHaveBeenCalled();
  });

  it('answers 404 for a user that does not exist', async () => {
    const { service } = build(null);

    await expect(
      service.update({ userId: ACTOR, adminToken: 't', targetUserId: 'gone' })
    ).rejects.toThrow('User not found');
  });
});
