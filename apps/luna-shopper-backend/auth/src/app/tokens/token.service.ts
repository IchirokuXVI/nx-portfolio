import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  permissionsOf,
  type AccessTokenClaims,
  type AuthTokens,
} from '@portfolio/luna-shopper/contracts';
import {
  ImpersonationEndedException,
  UnauthorizedException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import {
  IsNull,
  Repository,
  type DeepPartial,
  type EntityManager,
} from 'typeorm';
import type { AuthConfig } from '../config/app-config';
import {
  RefreshToken,
  type ImpersonationSession,
  type User,
} from '../entities';
import { parseDurationMs } from './duration';

/**
 * How long after its rotation a refresh row whose successor was never used can
 * obtain a fresh pair one time (plan 0229, section 3.3, decision D1).
 *
 * The measured retry is 65 ms behind the lost answer. The reload that the
 * recovery probe makes, and the first request of a new gateway pod after a
 * deploy, are seconds. Two minutes covers each of them with room, and it covers
 * a phone that lost the radio in a doorway.
 *
 * It does not cover a phone that was put away for ten minutes after a lost
 * answer. A window that long keeps a copied token replayable for as long after
 * the victim's rotation, against a victim whose successor sits unused because
 * they are idle. A family and reuse detection (finding F4 of the session token
 * review) is the answer to that case, not a longer window.
 */
export const REFRESH_REUSE_GRACE_MS = 120_000;

/**
 * How soon after a rotation finished a second presentation of its row is still
 * taken as a copy of the same request and not as a retry (plan 0229).
 *
 * A retry needs the answer to be lost first, and then the client sends a
 * request, gets 401 and refreshes: at least two round trips from the browser.
 * The measured retry began 65 to 80 ms after the rotation, on localhost. A
 * copy of the same request lags only by what the server adds, such as a new
 * pool connection: 11 ms in the run that showed it. Thirty milliseconds sits
 * between the two, nearer the copy, because a retry taken for a copy is the
 * sign out this plan exists to stop.
 */
export const REFRESH_RETRY_FLOOR_MS = 30;

/**
 * Why a refresh was refused (plan 0229, section 3.2). Logged, and never sent:
 * the client gets one message for each of them, so that the answer does not
 * tell a caller which of their guesses was once a real token.
 */
export type RefreshRefusal =
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'grace_over'
  | 'in_flight'
  | 'reissued_before'
  | 'successor_spent';

/** The one message of every refused refresh, whatever the reason. */
const REFRESH_REFUSED = 'Invalid or expired refresh token';

/**
 * The row that a rotation spent. `reissued` is true when the row was spent
 * before, inside the grace, and its unused successor was revoked in its place.
 */
export interface SpentRefreshToken {
  id: string;
  userId: string;
  impersonationSessionId: string | null;
  reissued: boolean;
}

/**
 * A pair, and the id of the refresh row that it wrote. A rotation records that
 * id on the row it spent, so it gets it from the insert and not from a second
 * read by hash.
 */
export interface RecordedTokens {
  tokens: AuthTokens;
  refreshRowId: string;
}

/** The row of a failed spend, read under its lock, with the clock judged in SQL. */
interface LockedRefreshRow {
  id: string;
  userId: string;
  impersonationSessionId: string | null;
  replacedById: string | null;
  revokedAt: Date | null;
  expired: boolean;
  graceOver: boolean | null;
  inFlight: boolean | null;
  reissuedBefore: boolean | null;
}

/**
 * Token issuance and rotation (plan 0005, section 3).
 *
 * The access token is a short lived JWT signed RS256 with the private key and a
 * `kid` header, verified offline everywhere by the public key (plan 0004,
 * section 10). The refresh token is opaque and high entropy, stored only as a
 * SHA-256 hash and rotated on every use, so a leaked database row never yields a
 * usable token and a stolen refresh token is single use.
 */
@Injectable()
export class TokenService {
  private readonly config: AuthConfig;
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /**
   * Signs an access token carrying the user id, kind and permissions.
   *
   * `perms` is computed here from the account's roles with `permissionsOf`
   * (plan 0175) and never read from a column, so a change to `PERMISSIONS_OF`
   * reaches every account at its next refresh. Every flow that signs a token
   * has just loaded the user row, so the roles are the ones committed now.
   */
  private signAccessToken(
    user: Pick<User, 'id' | 'kind' | 'roles'>
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, kind: user.kind, perms: permissionsOf(user.roles ?? []) },
      {
        privateKey: this.config.jwt.privateKey,
        algorithm: 'RS256',
        keyid: this.config.jwt.kid,
        // The TTL is a validated duration string ('15m'); cast to the ms-typed
        // property jsonwebtoken accepts at runtime.
        expiresIn: this.config.jwt
          .accessTokenTtl as JwtSignOptions['expiresIn'],
      }
    );
  }

  /**
   * Sign a basket scoped socket token for a participant (plan 0051, section 9).
   *
   * The one token this service issues that **names no user**, and the reason plan
   * 0035's rule becomes "a token that names neither a user nor a live
   * participant". Three properties make that safe, and all three are here rather
   * than in a comment somewhere else:
   *
   * - **No `sub`.** Deliberately absent rather than null or empty: a participant
   *   is not a user, and a guard that reads `sub` and asks no further questions
   *   must fail to find one rather than find something it will mistake for an
   *   account.
   * - **`aud` is the one basket**, so the token is worthless anywhere else, and a
   *   socket presenting it is checked against the room it asks for.
   * - **Short lived, and refreshed by presenting the participant credential**,
   *   which is the database read that carries revocation. That is what keeps
   *   section 3.3's promise honest: the token itself cannot be revoked, so it
   *   does not live long enough to matter, and the thing that renews it can be.
   *
   * It is signed with the same key and `kid` as an access token, on purpose: the
   * realtime service already verifies with that public key, so a guest's socket
   * needs no second trust root.
   */
  async signParticipantToken(req: {
    participantId: string;
    basketId: string;
    kind: string;
  }): Promise<{ socketToken: string; socketTokenExpiresAt: string }> {
    const ttl = this.config.jwt.participantTokenTtl;
    const socketToken = await this.jwt.signAsync(
      {
        participantId: req.participantId,
        kind: req.kind,
      },
      {
        privateKey: this.config.jwt.privateKey,
        algorithm: 'RS256',
        keyid: this.config.jwt.kid,
        audience: req.basketId,
        expiresIn: ttl as JwtSignOptions['expiresIn'],
      }
    );
    return {
      socketToken,
      socketTokenExpiresAt: new Date(
        Date.now() + parseDurationMs(ttl)
      ).toISOString(),
    };
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Mints and persists a fresh refresh token, returning the raw value once.
   *
   * `session` is given only for a support session (plan 0194). The row then
   * names the session and dies at its deadline. Without it the row has the
   * configured life, 30 days, exactly as before.
   *
   * A `manager` joins the caller's transaction (plan 0229). The id of the row
   * comes back beside the raw value, for the rotation that records it.
   */
  private async issueRefreshToken(
    userId: string,
    session?: Pick<ImpersonationSession, 'id' | 'expiresAt'>,
    manager?: EntityManager
  ): Promise<{ raw: string; id: string }> {
    const repository = this.repositoryOf(manager);
    const raw = randomBytes(32).toString('base64url');
    const expiresAt =
      session?.expiresAt ??
      new Date(Date.now() + parseDurationMs(this.config.jwt.refreshTokenTtl));
    const row = await repository.save(
      repository.create({
        userId,
        tokenHash: this.hash(raw),
        expiresAt,
        impersonationSessionId: session?.id ?? null,
      })
    );
    return { raw, id: row.id };
  }

  /** The repository of the caller's transaction, or the injected one. */
  private repositoryOf(manager?: EntityManager): Repository<RefreshToken> {
    return manager ? manager.getRepository(RefreshToken) : this.refreshTokens;
  }

  /**
   * Issues the token pair of a support session (plan 0194), for the exchange
   * and for a refresh alike.
   *
   * Three things differ from {@link issueTokens}, and each one is the session
   * row cutting a token to its deadline:
   *
   * - The access token carries `act`: the operator, the session, the deadline.
   * - Its `exp` is the earlier of now plus `ACCESS_TOKEN_TTL` and the deadline,
   *   so no token of a session outlives the session.
   * - The refresh row expires at the deadline and names the session.
   *
   * The caller has already decided that the session is live. This method
   * refuses a deadline in the past anyway, because a token that expires before
   * it is signed is a mistake whoever calls.
   */
  async issueTokensForSession(
    user: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    session: Pick<ImpersonationSession, 'id' | 'adminId' | 'expiresAt'>,
    manager?: EntityManager
  ): Promise<AuthTokens> {
    return (await this.issueTokensForSessionRecorded(user, session, manager))
      .tokens;
  }

  /**
   * {@link issueTokensForSession}, and the id of the refresh row it wrote. The
   * rotation of a support row uses it (plan 0229).
   */
  async issueTokensForSessionRecorded(
    user: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    session: Pick<ImpersonationSession, 'id' | 'adminId' | 'expiresAt'>,
    manager?: EntityManager
  ): Promise<RecordedTokens> {
    const now = Math.floor(Date.now() / 1000);
    const until = Math.floor(session.expiresAt.getTime() / 1000);
    if (until <= now) {
      throw new ImpersonationEndedException('The support session is over');
    }
    const ttl = Math.floor(
      parseDurationMs(this.config.jwt.accessTokenTtl) / 1000
    );
    const claims: AccessTokenClaims = {
      sub: user.id,
      kind: user.kind,
      perms: permissionsOf(user.roles ?? []),
      act: { sub: session.adminId, sid: session.id, until },
      // Stated as a claim and not as `expiresIn`, because the value is a moment
      // and not a duration: the earlier of the two ends.
      exp: Math.min(now + ttl, until),
    };
    const [accessToken, refresh] = await Promise.all([
      this.jwt.signAsync(claims, {
        privateKey: this.config.jwt.privateKey,
        algorithm: 'RS256',
        keyid: this.config.jwt.kid,
      }),
      this.issueRefreshToken(user.id, session, manager),
    ]);
    return {
      tokens: {
        userId: user.id,
        kind: user.kind,
        username: user.username,
        accessToken,
        refreshToken: refresh.raw,
      },
      refreshRowId: refresh.id,
    };
  }

  /**
   * Revokes every live refresh row of one support session (plan 0194), and no
   * other row. The sessions the person holds are not touched.
   */
  async revokeAllForSession(
    sessionId: string,
    manager?: EntityManager
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    await repository.update(
      { impersonationSessionId: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
  }

  /**
   * Issues a full token pair for a user (used by every successful flow). The
   * global username rides in the response body, never in the signed claims (plan
   * 0018, section 9): every caller already has the user row loaded, so filling it
   * costs nothing, and the client learns its own name on each sign in and refresh
   * without a claim that would go stale for the token's whole lifetime.
   */
  async issueTokens(
    user: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    manager?: EntityManager
  ): Promise<AuthTokens> {
    return (await this.issueTokensRecorded(user, manager)).tokens;
  }

  /**
   * {@link issueTokens}, and the id of the refresh row it wrote. The rotation
   * of an ordinary row uses it (plan 0229).
   */
  async issueTokensRecorded(
    user: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    manager?: EntityManager
  ): Promise<RecordedTokens> {
    const [accessToken, refresh] = await Promise.all([
      this.signAccessToken(user),
      this.issueRefreshToken(user.id, undefined, manager),
    ]);
    return {
      tokens: {
        userId: user.id,
        kind: user.kind,
        username: user.username,
        accessToken,
        refreshToken: refresh.raw,
      },
      refreshRowId: refresh.id,
    };
  }

  /**
   * Revokes every live refresh token a user holds (plan 0022, section 3.2).
   *
   * A password reset is usually somebody saying another person has their
   * password, so leaving that person's sessions alive means the reset changed
   * nothing for up to a refresh lifetime. The caller issues its own pair *after*
   * this, so the person doing the resetting stays signed in and everybody else
   * does not; doing it the other way round is the mistake this ordering exists to
   * avoid.
   *
   * Already revoked rows are left alone, so the update touches only what is live.
   * A `manager` joins the caller's transaction, so a reset that fails half way
   * does not leave a user signed out of everything with their old password still
   * working.
   */
  async revokeAllForUser(
    userId: string,
    manager?: EntityManager
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
  }

  /**
   * Spends a presented refresh token on the caller's transaction, or refuses
   * (plan 0229, section 3).
   *
   * **One conditional statement spends the row** (section 3.1), as
   * `TokenGrantService.spend` spends a grant. It used to read the row and then
   * save it, and two requests at the same instant both passed the read: one
   * token had two live children. Now the condition is in the `WHERE` of the
   * write. Postgres takes the row lock before it evaluates the condition, so
   * the second statement waits, reads the row again, finds `revokedAt` set and
   * updates nothing. Expiry is judged on the clock of the database, the same
   * clock that writes `revokedAt`.
   *
   * **A spend that updates nothing takes the grace path** (section 3.2) before
   * it refuses. See {@link spendWithinGrace}.
   *
   * The caller issues the successor on the same `manager` and records it with
   * {@link recordSuccessor}. Every write of the rotation is on that manager, so
   * a failure after the spend rolls the spend back and leaves the presented row
   * live. The support session of the row comes back (plan 0194), null for an
   * ordinary row, so the caller issues the next pair for the same session.
   */
  async rotate(
    rawToken: string,
    manager: EntityManager
  ): Promise<SpentRefreshToken> {
    const tokenHash = this.hash(rawToken);
    const result = await manager
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: () => 'now()' })
      .where(
        '"tokenHash" = :tokenHash AND "revokedAt" IS NULL AND "expiresAt" > now()',
        { tokenHash }
      )
      .returning('*')
      .execute();
    const row = (result.raw as Record<string, unknown>[] | undefined)?.[0];
    if (row) {
      const spent = this.fromRow(manager, row);
      return {
        id: spent.id,
        userId: spent.userId,
        impersonationSessionId: spent.impersonationSessionId ?? null,
        reissued: false,
      };
    }
    return this.spendWithinGrace(tokenHash, manager);
  }

  /**
   * Points the spent row at the row that replaced it (plan 0229, section 2),
   * in the transaction of the rotation. After a reissue inside the grace this
   * moves the pointer to the newest successor.
   *
   * It is the last write of a rotation, and `updatedAt` takes the wall clock of
   * the database (`clock_timestamp()`, not the start of the transaction). So
   * `updatedAt` of a spent row is the moment its rotation finished, and a later
   * presentation can tell whether it began before that moment
   * ({@link spendWithinGrace}, `in_flight`).
   */
  async recordSuccessor(
    spentId: string,
    successorId: string,
    manager: EntityManager
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ replacedById: successorId, updatedAt: () => 'clock_timestamp()' })
      .where('"id" = :id', { id: spentId })
      .execute();
  }

  /**
   * The grace path of a spend that updated nothing (plan 0229, section 3.2).
   *
   * The row is locked by its hash, so two retries of one lost answer queue on
   * the lock and do not decide at the same time. Every rule of time is judged
   * in the same SQL statement on the clock of the database: `now()` is the
   * start of this transaction, the clock that wrote `revokedAt`.
   *
   * Only a row that a rotation revoked has a successor. A row that a password
   * reset or the end of a support session revoked has none, and is refused at
   * once, inside the grace or outside it.
   *
   * When the successor is still unused, the answer that carried it was lost
   * and this presentation is the retry (section 3.2.1). The successor is
   * revoked in the same conditional way as a spend, and the caller issues a new
   * one. A successor that was used, or that a reset revoked, is not live, the
   * update spends nothing, and the presentation is refused.
   *
   * Two more refusals keep the retry to what it is for:
   *
   * - **`in_flight`: this presentation began before the rotation that spent
   *   the row finished, or within {@link REFRESH_RETRY_FLOOR_MS} after it.**
   *   A lost answer is lost after the rotation committed, so its retry always
   *   begins later. A presentation that overlapped the rotation is a second
   *   copy of the same request (two tabs, a doubled send). Without this rule
   *   it would wait on the lock, find the successor unused, and both requests
   *   would get a pair: the fork of finding F3.
   * - **`reissued_before`: the grace gives one fresh pair, one time.** The
   *   first successor is created in the transaction that revoked the row, so
   *   its `createdAt` equals the row's `revokedAt` (both are `now()` of that
   *   transaction). A successor created later is a reissue, and the row has
   *   had its one.
   */
  private async spendWithinGrace(
    tokenHash: string,
    manager: EntityManager
  ): Promise<SpentRefreshToken> {
    const [locked] = (await manager.query(
      `SELECT p."id", p."userId", p."impersonationSessionId", p."replacedById", p."revokedAt",
              p."expiresAt" <= now() AS "expired",
              p."revokedAt" < now() - ($2::integer * interval '1 millisecond') AS "graceOver",
              now() < p."updatedAt" + ($3::integer * interval '1 millisecond') AS "inFlight",
              (SELECT s."createdAt" > p."revokedAt"
                 FROM "refresh_tokens" s
                WHERE s."id" = p."replacedById") AS "reissuedBefore"
         FROM "refresh_tokens" p
        WHERE p."tokenHash" = $1
        FOR UPDATE OF p`,
      [tokenHash, REFRESH_REUSE_GRACE_MS, REFRESH_RETRY_FLOOR_MS]
    )) as LockedRefreshRow[];
    if (!locked) {
      return this.refuse('unknown');
    }
    const row = { rowId: locked.id, userId: locked.userId };
    if (locked.expired) {
      return this.refuse('expired', row);
    }
    // A live row has no successor either. It cannot reach this line, because
    // the spend before it would have spent it.
    if (!locked.revokedAt || !locked.replacedById) {
      return this.refuse('revoked', row);
    }
    if (locked.graceOver) {
      return this.refuse('grace_over', row);
    }
    if (locked.inFlight) {
      return this.refuse('in_flight', row);
    }
    if (locked.reissuedBefore) {
      return this.refuse('reissued_before', row);
    }
    const successor = await manager
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: () => 'now()' })
      .where('"id" = :id AND "revokedAt" IS NULL', {
        id: locked.replacedById,
      })
      .execute();
    if (!successor.affected) {
      return this.refuse('successor_spent', row);
    }
    this.logger.log({
      msg: 'Refresh reissued inside the grace',
      reason: 'reissued',
      ...row,
    });
    return {
      id: locked.id,
      userId: locked.userId,
      impersonationSessionId: locked.impersonationSessionId ?? null,
      reissued: true,
    };
  }

  /**
   * Logs one refusal and throws the one answer of every refusal (plan 0229,
   * section 3.4). The line names the reason and the row. It never names the
   * token, its hash or a prefix of either: a log line is not a place to keep a
   * credential.
   */
  private refuse(
    reason: RefreshRefusal,
    row?: { rowId: string; userId: string }
  ): never {
    this.logger.warn({ msg: 'Refresh refused', reason, ...row });
    throw new UnauthorizedException(REFRESH_REFUSED);
  }

  /**
   * An entity from a raw `RETURNING` row, by the column names of the table,
   * as `TokenGrantService` maps a spent grant.
   */
  private fromRow(
    manager: EntityManager,
    row: Record<string, unknown>
  ): RefreshToken {
    const fields: Record<string, unknown> = {};
    for (const column of manager.connection.getMetadata(RefreshToken).columns) {
      if (column.databaseName in row) {
        fields[column.propertyName] = row[column.databaseName];
      }
    }
    return manager
      .getRepository(RefreshToken)
      .create(fields as DeepPartial<RefreshToken>);
  }
}
