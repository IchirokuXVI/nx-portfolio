import { LEGAL_TEMPLATES } from '@portfolio/luna-shopper/contracts';
import type { EntityManager } from 'typeorm';
import type { TermsAcceptanceVia } from '../entities';
import { TermsService, type LatestTermsAcceptance } from './terms.service';

/** One recorded row of {@link InMemoryTermsService}. */
export interface RecordedTermsAcceptance {
  userId: string;
  version: string;
  via: TermsAcceptanceVia;
  acceptedAt: Date;
}

/**
 * A {@link TermsService} for the service specs, which build their subject by
 * hand over repository doubles that understand no SQL.
 *
 * The real {@link TermsService.record} is one `INSERT ... ON CONFLICT DO
 * NOTHING`, and a double that pretended to evaluate it would prove only that it
 * agrees with itself. So this one records into an array with the same rule. The
 * unique key under two concurrent accepts is proven against a real Postgres, in
 * `terms-acceptance.integration.spec.ts`, and nowhere else.
 *
 * Not a jest double, because `*.testing.ts` is compiled into the app build.
 */
export class InMemoryTermsService extends TermsService {
  readonly rows: RecordedTermsAcceptance[] = [];

  /** The config object the parent reads, kept so a spec can move the version. */
  private readonly settings: {
    currentVersion: string;
    acceptanceRequired: boolean;
  };

  constructor(
    options: { currentVersion?: string; acceptanceRequired?: boolean } = {}
  ) {
    const settings = {
      currentVersion: options.currentVersion ?? LEGAL_TEMPLATES.terms.version,
      acceptanceRequired: options.acceptanceRequired ?? false,
    };
    super(null as never, { getOrThrow: () => ({ terms: settings }) } as never);
    this.settings = settings;
  }

  /**
   * Moves the current version, as a redeploy with another template or
   * revision does.
   */
  moveCurrentVersion(version: string): void {
    this.settings.currentVersion = version;
  }

  override async record(
    _manager: EntityManager,
    userId: string,
    version: string,
    via: TermsAcceptanceVia
  ): Promise<void> {
    if (!this.rows.some((r) => r.userId === userId && r.version === version)) {
      this.rows.push({ userId, version, via, acceptedAt: new Date() });
    }
  }

  override async find(
    _manager: EntityManager,
    userId: string,
    version: string
  ): Promise<LatestTermsAcceptance | null> {
    const row = this.rows.find(
      (r) => r.userId === userId && r.version === version
    );
    return row ? { version: row.version, acceptedAt: row.acceptedAt } : null;
  }

  override async latest(userId: string): Promise<LatestTermsAcceptance | null> {
    const row = this.rows.filter((r) => r.userId === userId).at(-1);
    return row ? { version: row.version, acceptedAt: row.acceptedAt } : null;
  }
}
