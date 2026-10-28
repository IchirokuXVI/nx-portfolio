import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  IMPERSONATION_NOTE_MAX,
  ImpersonationReason,
  type AuthTokens,
  type CheckImpersonationRequest,
  type CheckImpersonationResult,
  type EndImpersonationRequest,
  type EndImpersonationResult,
  type ExchangeImpersonationRequest,
  type ImpersonationEndedEvent,
  type ImpersonationStatusRequest,
  type ImpersonationStatusView,
  type StartImpersonationRequest,
  type StartImpersonationResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ImpersonationCodeInvalidException,
  ImpersonationDisabledException,
  ImpersonationEndedException,
  NotFoundException,
  NotImpersonatingException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import {
  DataSource,
  IsNull,
  MoreThan,
  type EntityManager,
  type EntityTarget,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import { AuthPlatformAdminService } from '../admin/platform-admin.service';
import { AuthAuditService } from '../audit/auth-audit.service';
import type { AuthConfig } from '../config/app-config';
import { AdminUser, ImpersonationSession, User } from '../entities';
import { IdentityEventsPublisher } from '../events/identity-events.publisher';
import { TokenService, type RecordedTokens } from '../tokens/token.service';

/**
 * How long a support session lasts, from its start. A constant and not
 * configuration, because the owner fixed the number (plan 0194).
 */
export const IMPERSONATION_MAX_MS = 2 * 60 * 60 * 1000;

/** How long the handoff code is good for. */
export const IMPERSONATION_CODE_TTL_MS = 60 * 1000;

/** The one answer of a refused exchange, whatever the reason was. */
const CODE_INVALID = 'That support link is not valid';

/**
 * What the issue of a session's pair got: the pair, or the end of the session
 * (plan 0229).
 *
 * `endedNow` names a session that this call ended because its operator is
 * disabled or gone. On the caller's transaction that end is not committed yet,
 * so the caller announces it with {@link ImpersonationService.announceEnded}
 * after the commit, and not before.
 */
export type SessionRenewal =
  | { issued: RecordedTokens }
  | {
      over: ImpersonationEndedException;
      endedNow: ImpersonationEndedEvent | null;
    };

/** Whether a session is live, and the session that the check ended, if any. */
interface Liveness {
  live: boolean;
  endedNow: ImpersonationEndedEvent | null;
}

/**
 * Support sessions: an operator opens the app as a user (plan 0194).
 *
 * A session is a row with a hard deadline. The app gets a normal token pair
 * for the user, each access token names the operator in `act`, and every token
 * of the session is cut to the deadline of the row. Nothing extends it.
 *
 * Three rules hold in every method here:
 *
 * - **The deadline is written one time**, by {@link start}. No other line in
 *   this service names `expiresAt` on the left of an assignment, and the entity
 *   marks the column `update: false`.
 * - **The sessions of the person stay.** Starting or ending a support session
 *   revokes only the refresh rows that name that session.
 * - **The code is never logged**, and neither is a token. The raw code exists
 *   in the answer of {@link start} and nowhere else. The row holds its hash,
 *   and the audit trail leaves the hash out.
 *
 * No method lists sessions or ends the session of another operator. The plan
 * leaves both out: a history page waits for a reader of the audit trail.
 */
@Injectable()
export class ImpersonationService {
  private readonly enabled: boolean;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly gate: AuthPlatformAdminService,
    private readonly audit: AuthAuditService,
    private readonly events: IdentityEventsPublisher,
    configService: ConfigService
  ) {
    this.enabled =
      configService.getOrThrow<AuthConfig>('auth').impersonation.enabled;
  }

  /** Whether this deployment allows a support session. For the back office. */
  async status(
    req: ImpersonationStatusRequest
  ): Promise<ImpersonationStatusView> {
    await this.gate.requireAdmin(req);
    return { enabled: this.enabled };
  }

  /**
   * Start a session for one user.
   *
   * The row and its audit record are written in one transaction. Each earlier
   * session of the same operator and the same user that is still live ends in
   * that transaction too: two live sessions for one pair have no use, and an
   * operator who lost the tab needs a way back in.
   *
   * A guest can be the user. A `TEMPORARY` account is a `users` row like any
   * other, and bugs happen to guests too.
   */
  async start(
    req: StartImpersonationRequest
  ): Promise<StartImpersonationResult> {
    const adminId = await this.gate.requireAdmin(req);
    if (!this.enabled) {
      throw new ImpersonationDisabledException(
        'Support sessions are switched off in this deployment'
      );
    }
    const reasonNote = this.noteFor(req.reason, req.note);

    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: req.targetUserId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const code = randomBytes(32).toString('base64url');
    const now = Date.now();

    const { session, replaced } = await this.audit.write(
      adminId,
      async (tx) => {
        const earlier = await tx.manager.find(ImpersonationSession, {
          where: {
            adminId,
            userId: user.id,
            endedAt: IsNull(),
            expiresAt: MoreThan(new Date(now)),
          },
        });
        for (const row of earlier) {
          const before = { ...row };
          row.endedAt = new Date(now);
          await tx.update(ImpersonationSession, before, row);
          await this.tokens.revokeAllForSession(row.id, tx.manager);
        }

        const draft = tx.manager.create(ImpersonationSession, {
          adminId,
          userId: user.id,
          reason: req.reason,
          reasonNote,
          // The one write of the deadline.
          expiresAt: new Date(now + IMPERSONATION_MAX_MS),
          endedAt: null,
          codeHash: hashCode(code),
          codeExpiresAt: new Date(now + IMPERSONATION_CODE_TTL_MS),
          codeConsumedAt: null,
        });
        return {
          session: await tx.create(ImpersonationSession, draft),
          replaced: earlier.map((row) => row.id),
        };
      }
    );

    // After the commit, as every emit in this service is: an event for a
    // transaction that then rolled back would drop sockets of a live session.
    for (const sessionId of replaced) {
      this.events.impersonationEnded({ sessionId, userId: user.id });
    }

    return {
      sessionId: session.id,
      code,
      codeExpiresAt: session.codeExpiresAt.toISOString(),
      // The lifetime itself, so the back office holds no copy of the number.
      codeTtlMs: IMPERSONATION_CODE_TTL_MS,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Trade the handoff code for the token pair of the session.
   *
   * **One conditional `UPDATE ... RETURNING` consumes the code.** A read and
   * then a save is two statements, and two requests at the same instant both
   * pass the read. Here the row matches only while the code is unused, unexpired
   * and its session not ended, and Postgres lets one of two concurrent updates
   * see that state.
   *
   * A missing, used, old or ended code gets one answer, so that the answer says
   * nothing about which. So does every code while the switch is off.
   */
  async exchange(req: ExchangeImpersonationRequest): Promise<AuthTokens> {
    if (!this.enabled || typeof req.code !== 'string' || !req.code) {
      throw new ImpersonationCodeInvalidException(CODE_INVALID);
    }

    // An `UPDATE ... RETURNING` through `query()` answers `[rows, rowCount]`.
    const [rows] = (await this.dataSource.query(
      `UPDATE "impersonation_sessions"
          SET "codeConsumedAt" = now(), "updatedAt" = now()
        WHERE "codeHash" = $1
          AND "codeConsumedAt" IS NULL
          AND "codeExpiresAt" > now()
          AND "endedAt" IS NULL
        RETURNING "id"`,
      [hashCode(req.code)]
    )) as [Array<{ id: string }>, number];
    const consumed = rows[0];
    if (!consumed) {
      throw new ImpersonationCodeInvalidException(CODE_INVALID);
    }

    try {
      return await this.issue(consumed.id);
    } catch (error) {
      // The operator was disabled between the start and the exchange, or the
      // account went away. The same one answer as every other refusal here.
      if (
        error instanceof ImpersonationEndedException ||
        error instanceof NotFoundException
      ) {
        throw new ImpersonationCodeInvalidException(CODE_INVALID);
      }
      throw error;
    }
  }

  /**
   * The next pair of a session, for a refresh row that names it. Called by
   * `IdentityService.refresh` after the rotation spent the presented row, on
   * the manager of that rotation (plan 0229), so the session read, the end of
   * a session that is over and the new refresh row all join its transaction.
   * The id of the new row comes back for the rotation to record.
   *
   * A session that is over is an answer and not a throw, so that the caller
   * can commit the end and then announce it with {@link announceEnded}.
   */
  refresh(
    sessionId: string,
    user: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    manager: EntityManager
  ): Promise<SessionRenewal> {
    return this.issueRecorded(sessionId, user, manager);
  }

  /**
   * Announce a session that a check on the caller's transaction ended, after
   * that transaction committed. Nothing for null.
   */
  announceEnded(ended: ImpersonationEndedEvent | null): void {
    if (ended) {
      this.events.impersonationEnded(ended);
    }
  }

  /**
   * End the session the caller's token belongs to.
   *
   * A second call changes nothing and is not an error. The refresh rows of the
   * session are revoked, and no other row of the person is.
   */
  async end(req: EndImpersonationRequest): Promise<EndImpersonationResult> {
    if (!req.sessionId) {
      throw new NotImpersonatingException(
        'This token does not belong to a support session'
      );
    }
    const session = await this.dataSource
      .getRepository(ImpersonationSession)
      .findOne({ where: { id: req.sessionId, userId: req.userId } });
    if (!session || session.endedAt) {
      return { ended: false };
    }

    // The operator of the session is the actor. The token that asked is the
    // token that operator was handed.
    await this.audit.write(session.adminId, async (tx) => {
      const before = { ...session };
      session.endedAt = new Date();
      await tx.update(ImpersonationSession, before, session);
      await this.tokens.revokeAllForSession(session.id, tx.manager);
    });
    this.events.impersonationEnded({
      sessionId: session.id,
      userId: session.userId,
    });
    return { ended: true };
  }

  /**
   * Whether a session is live right now.
   *
   * The gateway asks on each request of a session, and realtime asks as a
   * socket connects. It is what makes "End", the deadline and a disabled
   * operator exact, and not late by the life of an access token.
   */
  async check(
    req: CheckImpersonationRequest
  ): Promise<CheckImpersonationResult> {
    if (!req.sessionId) {
      return { live: false };
    }
    const session = await this.dataSource
      .getRepository(ImpersonationSession)
      .findOne({ where: { id: req.sessionId } });
    if (!session) {
      return { live: false };
    }
    // No manager: the end of the session committed in its own statements.
    const { live, endedNow } = await this.isLive(session);
    this.announceEnded(endedNow);
    return { live };
  }

  /**
   * Issue the pair of a session, or refuse.
   *
   * One function for the exchange and for a refresh, so the two cannot
   * disagree on what a live session is.
   */
  private async issue(sessionId: string): Promise<AuthTokens> {
    const renewal = await this.issueRecorded(sessionId);
    if ('over' in renewal) {
      // No manager: the end of the session committed in its own statements,
      // so it is announced now, before the refusal.
      this.announceEnded(renewal.endedNow);
      throw renewal.over;
    }
    return renewal.issued.tokens;
  }

  /**
   * {@link issue}, and the id of the refresh row it wrote. A `manager` joins
   * the caller's transaction: the rotation of a refresh row passes one, and
   * the exchange of a code does not.
   *
   * A session that is over comes back as `over`, with the session that this
   * call ended, and is not thrown. The caller announces that end once it is
   * committed.
   */
  private async issueRecorded(
    sessionId: string,
    known?: Pick<User, 'id' | 'kind' | 'username' | 'roles'>,
    manager?: EntityManager
  ): Promise<SessionRenewal> {
    const session = await this.repositoryOf(
      ImpersonationSession,
      manager
    ).findOne({ where: { id: sessionId } });
    const { live, endedNow } = session
      ? await this.isLive(session, manager)
      : { live: false, endedNow: null };
    if (!session || !live) {
      return {
        over: new ImpersonationEndedException('The support session is over'),
        endedNow,
      };
    }
    const user =
      known ??
      (await this.repositoryOf(User, manager).findOne({
        where: { id: session.userId },
      }));
    if (!user) {
      throw new NotFoundException('User not found');
    }
    try {
      return {
        issued: await this.tokens.issueTokensForSessionRecorded(
          user,
          session,
          manager
        ),
      };
    } catch (error) {
      // The deadline passed between the check and the signature.
      if (error instanceof ImpersonationEndedException) {
        return { over: error, endedNow: null };
      }
      throw error;
    }
  }

  /**
   * The one definition of a live session: not ended, before its deadline, the
   * switch on, and an operator who is still enabled.
   *
   * A session whose operator is disabled or gone is ended here, in the same
   * call that found it. That write has no audit record: no operator made it,
   * and the trail names an operator on every row. The disabling of the
   * operator is itself done on the server, by the person who has the server.
   *
   * A `manager` runs the reads and that end on the caller's transaction. The
   * rotation of a refresh row passes one: it holds the lock of the presented
   * row, which a revoke on another connection would wait on for ever.
   *
   * It emits nothing. A session that this call ended comes back as
   * `endedNow`, and the caller announces it after the commit: on the caller's
   * transaction the end is not committed when this returns.
   */
  private async isLive(
    session: ImpersonationSession,
    manager?: EntityManager
  ): Promise<Liveness> {
    if (
      !this.enabled ||
      session.endedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return { live: false, endedNow: null };
    }
    const admin = await this.repositoryOf(AdminUser, manager).findOne({
      where: { id: session.adminId },
      select: { id: true, disabledAt: true },
    });
    if (admin && admin.disabledAt === null) {
      return { live: true, endedNow: null };
    }

    const ended = await this.repositoryOf(ImpersonationSession, manager).update(
      { id: session.id, endedAt: IsNull() },
      { endedAt: new Date() }
    );
    await this.tokens.revokeAllForSession(session.id, manager);
    return {
      live: false,
      endedNow: ended.affected
        ? { sessionId: session.id, userId: session.userId }
        : null,
    };
  }

  /** The repository of the caller's transaction, or of the data source. */
  private repositoryOf<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    manager?: EntityManager
  ): Repository<T> {
    return manager
      ? manager.getRepository(entity)
      : this.dataSource.getRepository(entity);
  }

  /**
   * The note to store for a reason, or a refusal. `OTHER` needs 1 to 500
   * characters. Every other reason refuses a note, so the column never holds
   * free text beside a reason that already says it.
   */
  private noteFor(reason: ImpersonationReason, note?: string): string | null {
    if (!Object.values(ImpersonationReason).includes(reason)) {
      throw new ValidationException('reason is not a known reason');
    }
    const trimmed = (note ?? '').trim();
    if (reason !== ImpersonationReason.OTHER) {
      if (trimmed) {
        throw new ValidationException(
          'note is only allowed with the reason OTHER'
        );
      }
      return null;
    }
    if (!trimmed || trimmed.length > IMPERSONATION_NOTE_MAX) {
      throw new ValidationException(
        `note must have 1 to ${IMPERSONATION_NOTE_MAX} characters for the reason OTHER`
      );
    }
    return trimmed;
  }
}

/** The stored form of a handoff code. */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
