import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  PostalCodeUsageListView,
  PostalCodeUsageRequest,
  PostalCodeUsageView,
} from '@portfolio/luna-shopper/contracts';
import { Repository } from 'typeorm';
import { ProfilePostalCode } from '../entities';
import { CorePlatformAdminService } from './platform-admin.service';

/** One row of the grouped query: one postal code, already counted six ways. */
interface UsageRow {
  postalCode: string;
  mainProfiles: string;
  nearbyProfiles: string;
  suppressedProfiles: string;
  mainUsers: string;
  nearbyUsers: string;
}

/**
 * How many profiles are waiting on a postal code (plan 0097, section 5).
 *
 * **The one prioritisation signal**, and `plans/backlog/0009` said so. It lives
 * in core because core owns the answer: `profile_postal_codes` holds the code,
 * the source and the suppressed flag, and `shopping_profiles` holds the
 * `userId`, so a distinct user count is one join inside one database. Nothing
 * crosses a service boundary, which is plan 0074 section 3's rule, and the
 * harvester's listing decorates its page with this rather than joining to it.
 *
 * **It answers about codes, never about people.** Six counts and no identities:
 * the operator is prioritising a discovery queue, and which households are in a
 * postcode is theirs.
 */
@Injectable()
export class AdminPostalCodeService {
  constructor(
    @InjectRepository(ProfilePostalCode)
    private readonly codes: Repository<ProfilePostalCode>,
    private readonly admin: CorePlatformAdminService
  ) {}

  /**
   * Up to one page of codes, answered in one round trip.
   *
   * **Every code asked about is in the answer, including the ones nobody uses.**
   * A screen decorating a page of rows needs the zeros, or a missing entry and a
   * zero read the same and neither says which.
   */
  async usage(req: PostalCodeUsageRequest): Promise<PostalCodeUsageListView> {
    await this.admin.requireAdmin(req);
    const country = (req.country ?? '').trim().toLowerCase();
    const postalCodes = [
      ...new Set(
        (req.postalCodes ?? []).map((code) => code.trim()).filter(Boolean)
      ),
    ];
    if (!country || postalCodes.length === 0) {
      return { country, usage: [] };
    }

    // One row per code, counted six ways in one pass.
    //
    // Conditional aggregation rather than a group per `source`, because the
    // distinct user counts do not add up: one person with a TYPED code on one
    // profile and a DEVICE code on another is one user, and summing two groups'
    // distinct counts would call them two. `COUNT(*)` is per profile and
    // `COUNT(DISTINCT p."userId")` is per person, which is exactly the pair the
    // screen shows, because a household with three profiles in one postcode is
    // three profiles and one person.
    //
    // `suppressed` is read on the NEARBY branch alone; it is meaningless on a
    // code the user typed, and plan 0062 only ever writes it on a derived row.
    const rows: UsageRow[] = await this.codes.query(
      `SELECT c."postalCode" AS "postalCode",
              (COUNT(*) FILTER (WHERE c."source" <> 'NEARBY'))::text
                AS "mainProfiles",
              (COUNT(*) FILTER (
                 WHERE c."source" = 'NEARBY' AND c."suppressed" = false))::text
                AS "nearbyProfiles",
              (COUNT(*) FILTER (
                 WHERE c."source" = 'NEARBY' AND c."suppressed" = true))::text
                AS "suppressedProfiles",
              (COUNT(DISTINCT p."userId") FILTER (
                 WHERE c."source" <> 'NEARBY'))::text
                AS "mainUsers",
              (COUNT(DISTINCT p."userId") FILTER (
                 WHERE c."source" = 'NEARBY' AND c."suppressed" = false))::text
                AS "nearbyUsers"
         FROM "profile_postal_codes" AS c
         JOIN "shopping_profiles" AS p ON p."id" = c."profileId"
        WHERE lower(c."country") = $1
          AND c."postalCode" = ANY($2::text[])
        GROUP BY 1`,
      [country, postalCodes]
    );

    const byCode = new Map<string, PostalCodeUsageView>();
    for (const row of rows) {
      byCode.set(row.postalCode, {
        postalCode: row.postalCode,
        mainProfiles: Number(row.mainProfiles),
        nearbyProfiles: Number(row.nearbyProfiles),
        suppressedProfiles: Number(row.suppressedProfiles),
        mainUsers: Number(row.mainUsers),
        nearbyUsers: Number(row.nearbyUsers),
      });
    }

    return {
      country,
      usage: postalCodes.map((code) => byCode.get(code) ?? empty(code)),
    };
  }
}

/** Zero of everything, for a code nobody uses. */
function empty(postalCode: string): PostalCodeUsageView {
  return {
    postalCode,
    mainProfiles: 0,
    nearbyProfiles: 0,
    suppressedProfiles: 0,
    mainUsers: 0,
    nearbyUsers: 0,
  };
}
