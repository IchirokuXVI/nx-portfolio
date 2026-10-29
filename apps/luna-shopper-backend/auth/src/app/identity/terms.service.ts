import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TERMS_CURRENT_VERSION_DETAIL,
  TermsAcceptanceMissingException,
  TermsVersionStaleException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import { TermsAcceptance, TermsAcceptanceVia } from '../entities';

/** The newest acceptance of an account. */
export interface LatestTermsAcceptance {
  version: string;
  acceptedAt: Date;
}

/**
 * The one rule about the Terms, used by every path that creates an account
 * (plan 0231, section 4.1).
 *
 * The version is compared for equality and never parsed for order: a version
 * is either the current one or it is not. A supplied version that is stale is
 * refused even while acceptance is not required, because only a client that
 * drew a version sends one, and a mismatch means the person read a text that
 * is no longer the text.
 */
@Injectable()
export class TermsService {
  private readonly config: AuthConfig['terms'];

  constructor(
    private readonly dataSource: DataSource,
    configService: ConfigService
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth').terms;
  }

  /** The effective version every path compares against. */
  get currentVersion(): string {
    return this.config.currentVersion;
  }

  /** `TERMS_ACCEPTANCE_REQUIRED` of this deployment. */
  get acceptanceRequired(): boolean {
    return this.config.acceptanceRequired;
  }

  /** Whether `supplied` is exactly the current version. */
  isCurrent(supplied: string | null | undefined): supplied is string {
    return supplied === this.config.currentVersion;
  }

  /** Throws when `supplied` is present and not current, or absent while acceptance is required. */
  assertAcceptable(supplied: string | null | undefined): void {
    const details = {
      [TERMS_CURRENT_VERSION_DETAIL]: this.config.currentVersion,
    };
    if (supplied === undefined || supplied === null || supplied === '') {
      if (this.config.acceptanceRequired) {
        throw new TermsAcceptanceMissingException(
          'Accept the Terms to continue',
          { details }
        );
      }
      return;
    }
    if (!this.isCurrent(supplied)) {
      throw new TermsVersionStaleException(
        'The Terms changed; accept the current version',
        { details }
      );
    }
  }

  /** Inserts `(userId, version, via)` ON CONFLICT DO NOTHING, inside the caller's transaction. */
  async record(
    manager: EntityManager,
    userId: string,
    version: string,
    via: TermsAcceptanceVia
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "terms_acceptances" ("userId", "version", "via")
       VALUES ($1, $2, $3)
       ON CONFLICT ("userId", "version") DO NOTHING`,
      [userId, version, via]
    );
  }

  /** The row of one account and one version, or null. */
  async find(
    manager: EntityManager,
    userId: string,
    version: string
  ): Promise<LatestTermsAcceptance | null> {
    const row = await manager
      .getRepository(TermsAcceptance)
      .findOne({ where: { userId, version } });
    return row ? { version: row.version, acceptedAt: row.acceptedAt } : null;
  }

  /** The newest row of the account, or null. */
  async latest(userId: string): Promise<LatestTermsAcceptance | null> {
    const row = await this.dataSource.getRepository(TermsAcceptance).findOne({
      where: { userId },
      order: { acceptedAt: 'DESC' },
    });
    return row ? { version: row.version, acceptedAt: row.acceptedAt } : null;
  }
}
