import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { ProfilePostalCode } from '../entities';
import { AdminPostalCodeService } from './admin-postal-code.service';
import type { CorePlatformAdminService } from './platform-admin.service';

const ADMIN = 'admin-1';

function admin(): CorePlatformAdminService {
  return {
    requireAdmin: async (credential: { adminToken?: string }) => {
      if (credential.adminToken !== 'good') {
        throw new ForbiddenException('Only an operator can read this');
      }
      return ADMIN;
    },
  } as unknown as CorePlatformAdminService;
}

/**
 * One row of the grouped query, as Postgres answers it: every count a string,
 * because `COUNT(*)` is a bigint and the driver will not lose precision on the
 * way out.
 */
function counted(
  postalCode: string,
  over: Partial<Record<string, number>> = {}
) {
  return {
    postalCode,
    mainProfiles: String(over.mainProfiles ?? 0),
    nearbyProfiles: String(over.nearbyProfiles ?? 0),
    suppressedProfiles: String(over.suppressedProfiles ?? 0),
    mainUsers: String(over.mainUsers ?? 0),
    nearbyUsers: String(over.nearbyUsers ?? 0),
  };
}

function build(rows: unknown[] = []) {
  const query = jest.fn(async () => rows);
  const codes = { query } as unknown as Repository<ProfilePostalCode>;
  return { service: new AdminPostalCodeService(codes, admin()), query };
}

/**
 * The demand behind a postal code (plan 0097, section 5).
 *
 * The SQL itself is asserted against a database in the integration suite; what
 * is checked here is the contract around it: who may ask, what a code nobody
 * uses answers, and that a page of codes is one call.
 */
describe('AdminPostalCodeService (plan 0097)', () => {
  it('refuses a caller with no operator token', async () => {
    const { service, query } = build();

    await expect(
      service.usage({ country: 'es', postalCodes: ['14013'] })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers zeros for a code nobody uses rather than leaving it out', async () => {
    // A missing entry and a zero read the same to a screen decorating rows, and
    // neither says which, so every code asked about is in the answer.
    const { service } = build([counted('14013', { mainProfiles: 3 })]);

    const view = await service.usage({
      adminToken: 'good',
      country: 'es',
      postalCodes: ['14013', '14010'],
    });

    expect(view.usage).toEqual([
      {
        postalCode: '14013',
        mainProfiles: 3,
        nearbyProfiles: 0,
        suppressedProfiles: 0,
        mainUsers: 0,
        nearbyUsers: 0,
      },
      {
        postalCode: '14010',
        mainProfiles: 0,
        nearbyProfiles: 0,
        suppressedProfiles: 0,
        mainUsers: 0,
        nearbyUsers: 0,
      },
    ]);
  });

  it('answers a page of codes in one round trip', async () => {
    const { service, query } = build([]);

    await service.usage({
      adminToken: 'good',
      country: 'es',
      postalCodes: ['14013', '14010', '14011', '14012'],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      'es',
      ['14013', '14010', '14011', '14012'],
    ]);
  });

  it('deduplicates and normalizes what it was asked', async () => {
    const { service, query } = build([]);

    await service.usage({
      adminToken: 'good',
      country: ' ES ',
      postalCodes: ['14013', ' 14013 ', '', '  '],
    });

    expect(query.mock.calls[0][1]).toEqual(['es', ['14013']]);
  });

  it('asks nothing when the request named no codes', async () => {
    const { service, query } = build([]);

    const view = await service.usage({
      adminToken: 'good',
      country: 'es',
      postalCodes: [],
    });

    expect(query).not.toHaveBeenCalled();
    expect(view).toEqual({ country: 'es', usage: [] });
  });

  it('keeps the three counts apart, because they are different facts', async () => {
    // A code twelve people typed is a place people shop; a code derived onto
    // twelve profiles is a place we widened into, and a suppressed row is
    // somebody who was offered it and said no.
    const { service } = build([
      counted('14013', {
        mainProfiles: 4,
        mainUsers: 3,
        nearbyProfiles: 9,
        nearbyUsers: 7,
        suppressedProfiles: 2,
      }),
    ]);

    const view = await service.usage({
      adminToken: 'good',
      country: 'es',
      postalCodes: ['14013'],
    });

    expect(view.usage[0]).toEqual({
      postalCode: '14013',
      mainProfiles: 4,
      nearbyProfiles: 9,
      suppressedProfiles: 2,
      mainUsers: 3,
      nearbyUsers: 7,
    });
  });
});

/**
 * The query itself, read rather than run.
 *
 * These are the two things the SQL must do that a fake repository cannot show,
 * and both are the kind of mistake that reads correctly and answers wrongly:
 * counting profiles where a person was meant, and letting a suppressed row into
 * the number that says who is waiting.
 */
describe('The usage query (plan 0097, section 5)', () => {
  async function sql(): Promise<string> {
    const { service, query } = build([]);
    await service.usage({
      adminToken: 'good',
      country: 'es',
      postalCodes: ['14013'],
    });
    return String(query.mock.calls[0][0]);
  }

  it('counts distinct users per person and rows per profile', async () => {
    const text = await sql();

    expect(text).toContain('COUNT(DISTINCT p."userId")');
    // Two profiles owned by one person are two profiles and one user, which is
    // the pair the screen shows.
    expect(text).toContain('"shopping_profiles"');
  });

  it('leaves suppressed rows out of the nearby count and reports them apart', async () => {
    const text = await sql();

    expect(text).toContain(`c."source" = 'NEARBY' AND c."suppressed" = false`);
    expect(text).toContain(`c."source" = 'NEARBY' AND c."suppressed" = true`);
  });
});
