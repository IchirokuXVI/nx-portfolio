import {
  UserKind,
  UsernamePropagation,
} from '@portfolio/luna-shopper/contracts';
import { fakeAudit } from '../audit/auth-audit.testing';
import { EmailVerification, User } from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * What an operator may do to somebody else's identity, and what it leaves behind
 * (plan 0077, sections 3 and 8).
 *
 * The interesting assertion is not that the write happened. It is that the
 * operator path and the user's own path are **the same write**: the rename emits
 * the event core propagates into every zone, and it emits it with the payload the
 * person's own route would have produced. A second implementation that forgot the
 * event would leave a user whose global name changed and whose name in every zone
 * did not, with nothing to reconcile them afterwards.
 *
 * The trail is asserted through {@link fakeAudit}, which runs the real
 * `diffFields` and drops the real secret columns, so "one row, and no token hash
 * in it" is a statement about the code rather than about the double.
 */

const ACTOR = 'a1';

/** A repository double that records rows and answers findOne from them. */
function makeUserRepo(rows: Partial<User>[] = []) {
  const store = [...rows];
  return {
    store,
    create: jest.fn((row: Partial<User>) => ({ ...row })),
    save: jest.fn(async (row: Partial<User>) => {
      const saved = { id: row.id ?? `u${store.length + 1}`, ...row } as User;
      const index = store.findIndex((r) => r.id === saved.id);
      if (index >= 0) {
        store[index] = saved;
      } else {
        store.push(saved);
      }
      return saved;
    }),
    findOne: jest.fn(
      async ({ where }: { where: Partial<User> }) =>
        store.find((r) => r.id === where.id) ?? null
    ),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const index = store.findIndex((r) => r.id === id);
      if (index < 0) {
        return { affected: 0 };
      }
      store.splice(index, 1);
      return { affected: 1 };
    }),
  };
}

/** The grants table a resend writes into. */
function makeVerificationRepo() {
  const store: Record<string, unknown>[] = [];
  return {
    store,
    create: jest.fn((row: Record<string, unknown>) => ({ ...row })),
    save: jest.fn(async (row: Record<string, unknown>) => {
      const saved = { id: `v${store.length + 1}`, ...row };
      store.push(saved);
      return saved;
    }),
  };
}

function build(users: Partial<User>[] = []) {
  const userRepo = makeUserRepo(users);
  const verifications = makeVerificationRepo();
  const repositoryFor = (target: unknown) =>
    target === EmailVerification ? verifications : userRepo;
  const manager = { getRepository: repositoryFor };
  const dataSource = {
    manager,
    getRepository: jest.fn(repositoryFor),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
      cb(manager)
    ),
  };
  const events = {
    userRegistered: jest.fn(),
    userUpgraded: jest.fn(),
    userDeleted: jest.fn(),
    userEmailVerified: jest.fn(),
    userUsernameChanged: jest.fn(),
  };
  const mail = { sendVerificationEmail: jest.fn() };
  const audit = fakeAudit([
    [User, { name: 'users', repository: userRepo as never }],
    [
      EmailVerification,
      { name: 'email_verifications', repository: verifications as never },
    ],
  ]);
  const service = new IdentityService(
    dataSource as never,
    { issueTokens: jest.fn() } as never,
    new TokenGrantService(),
    { hash: jest.fn(), verify: jest.fn() } as never,
    mail as never,
    events as never,
    new UsernameGenerator(),
    audit.service,
    {
      getOrThrow: () => ({
        smtp: { verifyBaseUrl: 'https://x', enabled: true },
        google: { enabled: true },
      }),
    } as never
  );
  return { service, userRepo, verifications, events, mail, audit };
}

function existingUser(over: Partial<User> = {}): Partial<User> {
  return {
    id: 'u1',
    kind: UserKind.REGISTERED,
    username: 'Swift Sail',
    email: 'a@b.com',
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    displayName: 'Alice',
    ...over,
  };
}

/** The rename event without the id that is unique to each change by design. */
function renamePayload(events: { userUsernameChanged: jest.Mock }) {
  const [payload] = events.userUsernameChanged.mock.calls[0];
  const { eventId, ...rest } = payload;
  void eventId;
  return rest;
}

describe('IdentityService.setUsernameAsOperator (section 3.1)', () => {
  it('emits exactly what the person renaming themselves emits', async () => {
    const own = build([existingUser()]);
    await own.service.setUsername({
      userId: 'u1',
      username: 'Vela Rápida',
      propagation: UsernamePropagation.ALL_ZONES,
    });

    const operator = build([existingUser()]);
    await operator.service.setUsernameAsOperator(
      'u1',
      'Vela Rápida',
      ACTOR,
      UsernamePropagation.ALL_ZONES
    );

    // The event is what core's propagation consumes, so the two payloads
    // agreeing is what makes the per zone names follow an operator's rename.
    expect(renamePayload(operator.events)).toEqual(renamePayload(own.events));
  });

  it('defaults the propagation the way the user facing path defaults it', async () => {
    const own = build([existingUser()]);
    await own.service.setUsername({ userId: 'u1', username: 'Steady Helm' });

    const operator = build([existingUser()]);
    await operator.service.setUsernameAsOperator('u1', 'Steady Helm', ACTOR);

    expect(renamePayload(operator.events)).toEqual(renamePayload(own.events));
    expect(renamePayload(operator.events)).toMatchObject({
      propagation: UsernamePropagation.GLOBAL_ONLY,
    });
  });

  it('commits the new name to the column both paths write', async () => {
    const { service, userRepo } = build([existingUser()]);

    const profile = await service.setUsernameAsOperator(
      'u1',
      'Vela Rápida',
      ACTOR
    );

    expect(profile.username).toBe('Vela Rápida');
    expect(userRepo.store[0].username).toBe('Vela Rápida');
  });

  it('records one row naming the operator, the row and the field that moved', async () => {
    const { service, audit } = build([existingUser()]);

    await service.setUsernameAsOperator('u1', 'Vela Rápida', ACTOR);

    expect(audit.recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'users',
        entityId: 'u1',
        before: { username: 'Swift Sail' },
        after: { username: 'Vela Rápida' },
      },
    ]);
  });

  it('records nothing when the name it was handed is the one already there', async () => {
    const { service, audit } = build([existingUser()]);

    await service.setUsernameAsOperator('u1', 'Swift Sail', ACTOR);

    expect(audit.recorded).toEqual([]);
  });
});

describe('IdentityService.setDisplayNameAsOperator (section 3.2)', () => {
  it('writes the column and records one row', async () => {
    const { service, userRepo, audit } = build([existingUser()]);

    const profile = await service.setDisplayNameAsOperator(
      'u1',
      'Alice Cooper',
      ACTOR
    );

    expect(profile.displayName).toBe('Alice Cooper');
    expect(userRepo.store[0].displayName).toBe('Alice Cooper');
    expect(audit.recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'users',
        entityId: 'u1',
        before: { displayName: 'Alice' },
        after: { displayName: 'Alice Cooper' },
      },
    ]);
  });

  it('clears the column when it is handed null', async () => {
    const { service, userRepo } = build([existingUser()]);

    await service.setDisplayNameAsOperator('u1', null, ACTOR);

    expect(userRepo.store[0].displayName).toBeNull();
  });

  it('emits nothing, because nothing consumes a display name', async () => {
    const { service, events } = build([existingUser()]);

    await service.setDisplayNameAsOperator('u1', 'Alice Cooper', ACTOR);

    expect(events.userUsernameChanged).not.toHaveBeenCalled();
  });

  it('records nothing when the name it was handed is the one already there', async () => {
    const { service, audit } = build([existingUser()]);

    await service.setDisplayNameAsOperator('u1', 'Alice', ACTOR);

    expect(audit.recorded).toEqual([]);
  });
});

describe('IdentityService.deleteAccountAsOperator (0074 audited, section 8)', () => {
  it('removes the row, emits the deletion and records what was lost', async () => {
    const { service, userRepo, events, audit } = build([existingUser()]);

    await expect(service.deleteAccountAsOperator('u1', ACTOR)).resolves.toEqual(
      { userId: 'u1', deleted: true }
    );

    expect(userRepo.store).toEqual([]);
    expect(events.userDeleted).toHaveBeenCalledWith({ userId: 'u1' });
    expect(audit.recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'DELETE',
        entity: 'users',
        entityId: 'u1',
        before: {
          kind: UserKind.REGISTERED,
          username: 'Swift Sail',
          email: 'a@b.com',
          emailVerifiedAt: '2026-08-01T00:00:00.000Z',
          displayName: 'Alice',
        },
        after: null,
      },
    ]);
  });

  it('is idempotent: a second delete emits nothing and records nothing', async () => {
    const { service, events, audit } = build([]);

    await expect(service.deleteAccountAsOperator('u1', ACTOR)).resolves.toEqual(
      { userId: 'u1', deleted: false }
    );

    expect(events.userDeleted).not.toHaveBeenCalled();
    expect(audit.recorded).toEqual([]);
  });
});

describe('IdentityService.resendVerificationAsOperator (0074 audited, section 8)', () => {
  const unconfirmed = existingUser({ emailVerifiedAt: null });

  it('mails the link and records the grant it wrote', async () => {
    const { service, mail, audit, verifications } = build([{ ...unconfirmed }]);

    await service.resendVerificationAsOperator('u1', ACTOR, 'es');

    expect(mail.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(audit.recorded).toHaveLength(1);
    expect(audit.recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'CREATE',
      entity: 'email_verifications',
      entityId: verifications.store[0]['id'],
      before: null,
    });
  });

  it('never lets the token hash reach the trail', async () => {
    const { service, audit, verifications } = build([{ ...unconfirmed }]);

    await service.resendVerificationAsOperator('u1', ACTOR);

    // The row genuinely carries one, so the trail has something to leak.
    expect(verifications.store[0]['tokenHash']).toEqual(expect.any(String));
    expect(JSON.stringify(audit.recorded)).not.toContain(
      verifications.store[0]['tokenHash']
    );
    expect(audit.recorded[0].after).not.toHaveProperty('tokenHash');
  });

  it('keeps auth own refusals, which are statements about the account', async () => {
    const confirmed = build([existingUser()]);
    await expect(
      confirmed.service.resendVerificationAsOperator('u1', ACTOR)
    ).rejects.toThrow();
    expect(confirmed.audit.recorded).toEqual([]);

    const addressless = build([existingUser({ email: null })]);
    await expect(
      addressless.service.resendVerificationAsOperator('u1', ACTOR)
    ).rejects.toThrow();
    expect(addressless.audit.recorded).toEqual([]);
  });
});
