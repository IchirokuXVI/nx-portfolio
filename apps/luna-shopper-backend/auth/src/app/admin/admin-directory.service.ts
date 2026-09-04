import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AuthProvider,
  UserKind,
  type AdminIdentityListView,
  type AdminIdentityView,
  type AdminUserDetailView,
  type AdminUserPage,
  type AdminUserRefView,
  type AdminUserView,
  type DeleteAdminUserRequest,
  type DeleteAdminUserResult,
  type GetAdminUserRequest,
  type ListAdminsRequest,
  type ListAdminUsersRequest,
  type ResendAdminVerificationRequest,
  type ResendAdminVerificationResult,
  type ResolveAdminUsersRequest,
  type ResolveAdminUsersResult,
  type UpdateAdminUserRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NotFoundException,
} from '@portfolio/luna-shopper/platform';
import { In, Repository } from 'typeorm';
import { AdminUser, Credential, OAuthIdentity, User } from '../entities';
import { IdentityService } from '../identity/identity.service';
import { AuthPlatformAdminService } from './platform-admin.service';

/** Where a page of users left off: newest first, ties broken by id. */
interface UserCursor {
  value: string;
  id: string;
}

/**
 * The back office's user directory (plan 0074).
 *
 * **Read, plus an edit and two named actions.** Every write calls
 * {@link IdentityService}, the same class the user's own routes call, so an
 * operator deleting an account runs the identical cascade and emits the identical
 * `user.deleted` event that core is already listening for, and an operator
 * renaming somebody publishes the rename core propagates into every zone.
 * Nothing here writes a row, and there is still no generic row editor over
 * `users`: the invariants live in services across three databases, and an
 * `UPDATE users SET ...` reaches none of them (plan 0077, section 1).
 *
 * The edit is plan 0077 section 3, and it reaches two columns. `email`,
 * `emailVerifiedAt` and `kind` are not among them, and their absence is a
 * decision recorded in sections 6.1 and 6.2 rather than an omission:
 * `admin-user-immutable-fields.spec.ts` asserts that no request shape carries
 * one. Admins are not editable either, permanently, by plan 0071 section 6.
 *
 * Every method gates first, on the token rather than on a uuid, and the gate is
 * auth's own (`AuthPlatformAdminService`) rather than something the gateway
 * asserted.
 *
 * **`passwordHash` never leaves this file, and never enters it.** For velista
 * users the guarantee is structural: the hash lives on `credentials`, and the
 * only thing this service asks that table is whether a row exists. For admins it
 * is a column on the row being read, so the roster names its columns explicitly
 * instead of selecting the entity. `admin-directory.redaction.spec.ts` asserts
 * the responses rather than the mappers, so a future `select('*')` fails a test.
 */
@Injectable()
export class AdminDirectoryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    @InjectRepository(OAuthIdentity)
    private readonly identities: Repository<OAuthIdentity>,
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
    private readonly gate: AuthPlatformAdminService,
    private readonly identity: IdentityService
  ) {}

  /**
   * A page of users, newest first (plan 0074, section 2).
   *
   * The filters compose with AND and every one of them is optional, so a request
   * naming none is the whole table. `username` rides the plain `ix_users_username`
   * index, which exists for this screen and for nothing velista does; `email` has
   * no index and is a contains match, which is fine at this table's size and is
   * worth revisiting before it is not.
   *
   * `verified` is a boolean over a nullable timestamp, and false deliberately
   * means **unconfirmed or absent**: a temporary user with no address has not
   * confirmed one, and an operator filtering for unconfirmed accounts wants them
   * in the answer rather than in a third state they have to know to ask for.
   */
  async list(req: ListAdminUsersRequest): Promise<AdminUserPage> {
    await this.gate.requireAdmin(req);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as UserCursor | undefined;
    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u."createdAt"', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .take(limit + 1);

    if (req.username) {
      qb.andWhere('u.username ILIKE :username', {
        username: `%${req.username}%`,
      });
    }
    if (req.email) {
      qb.andWhere('u.email ILIKE :email', { email: `%${req.email}%` });
    }
    if (req.kind) {
      qb.andWhere('u.kind = :kind', { kind: req.kind });
    }
    if (req.verified !== undefined) {
      qb.andWhere(
        req.verified
          ? 'u."emailVerifiedAt" IS NOT NULL'
          : 'u."emailVerifiedAt" IS NULL'
      );
    }
    if (req.createdAfter) {
      qb.andWhere('u."createdAt" >= :after', { after: req.createdAfter });
    }
    if (req.createdBefore) {
      qb.andWhere('u."createdAt" < :before', { before: req.createdBefore });
    }
    if (cursor) {
      qb.andWhere('(u."createdAt", u.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toUserView),
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * One user, with the two credential facts a listing row does not pay for.
   *
   * Both are separate tables, and a page of fifty rows would be two more queries
   * per row for facts nobody reads until they open one. Neither carries a secret:
   * `hasPassword` says a credential row exists and nothing about it, and
   * `providers` names the providers linked to the account rather than the
   * provider side ids they are linked by.
   */
  async get(req: GetAdminUserRequest): Promise<AdminUserDetailView> {
    await this.gate.requireAdmin(req);
    return this.detail(req.targetUserId);
  }

  /**
   * Change somebody's username or display name (plan 0077, section 3).
   *
   * Both fields are optional and each is applied only when the request carries
   * it, so a form saved unchanged reaches no write and records no audit row. For
   * `displayName` the distinction is three ways rather than two: absent leaves
   * the column alone, and an explicit null clears it.
   *
   * The two are not the same kind of write, which is the whole of section 3.
   * `username` goes through {@link IdentityService.setUsernameAsOperator},
   * because the rename has to publish the event core propagates into every zone.
   * `displayName` is a direct column write, because nothing derives from it.
   *
   * The gate runs once, here, and hands down the actor id every audited write
   * records. Reading the answer back afterwards therefore calls {@link detail}
   * rather than {@link get}: verifying the operator token a second time to
   * produce a view this method already earned is work with no question behind it.
   */
  async update(req: UpdateAdminUserRequest): Promise<AdminUserDetailView> {
    const actorId = await this.gate.requireAdmin(req);

    if (req.username !== undefined) {
      await this.identity.setUsernameAsOperator(
        req.targetUserId,
        req.username,
        actorId,
        req.usernamePropagation
      );
    }
    if (req.displayName !== undefined) {
      await this.identity.setDisplayNameAsOperator(
        req.targetUserId,
        req.displayName,
        actorId
      );
    }

    return this.detail(req.targetUserId);
  }

  /** One user's detail view, for a caller that has already passed the gate. */
  private async detail(targetUserId: string): Promise<AdminUserDetailView> {
    const user = await this.users.findOne({ where: { id: targetUserId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // `countBy` rather than reading the row: the count answers the question and
    // the row would carry the hash into this process for no reason.
    const credentials = await this.credentials.countBy({ userId: user.id });
    const links = await this.identities.find({
      where: { userId: user.id },
      select: { provider: true },
    });

    return {
      ...toUserView(user),
      hasPassword: credentials > 0,
      // A password account is `EMAIL` and has no `oauth_identities` row, so the
      // provider list is derived from both halves rather than from the table
      // alone, which would report an empty list for somebody who signs in daily.
      providers: [
        ...(credentials > 0 ? [AuthProvider.EMAIL] : []),
        ...links.map((link) => link.provider),
      ],
    };
  }

  /**
   * Names for a set of ids, for a listing in another service that has to render
   * them (plan 0074, section 3).
   *
   * **Only what was found.** An id belonging to a reaped user, or one racing a
   * deletion, is simply absent from the answer, and the caller renders the id.
   * Throwing here would let one missing name fail a page of zones, which is
   * exactly the failure section 3 forbids.
   *
   * An empty request is an empty answer and not a query: a listing whose rows all
   * happened to have no owner should not reach the database to be told so.
   */
  async resolveMany(
    req: ResolveAdminUsersRequest
  ): Promise<ResolveAdminUsersResult> {
    await this.gate.requireAdmin(req);
    if (!req.userIds?.length) {
      return { users: [] };
    }

    const rows = await this.users.find({
      where: { id: In(req.userIds) },
      select: { id: true, username: true, displayName: true },
    });
    return { users: rows.map(toUserRef) };
  }

  /**
   * Delete somebody's account, by running the user's own deletion.
   *
   * Idempotent for the same reason the user facing one is: a repeat affects no
   * rows and emits nothing, and answers `deleted: false` rather than a 404. An
   * operator who clicks twice has not made a mistake worth an error.
   */
  async deleteUser(
    req: DeleteAdminUserRequest
  ): Promise<DeleteAdminUserResult> {
    const actorId = await this.gate.requireAdmin(req);
    return this.identity.deleteAccountAsOperator(req.targetUserId, actorId);
  }

  /**
   * Send the confirmation mail again, on somebody else's behalf.
   *
   * The throttle this is described as bypassing is a **gateway** decorator on the
   * user's own route, so bypassing it is a matter of the admin route not carrying
   * one. Auth's own refusals are untouched and still apply: an account with no
   * address, or one already confirmed, is a conflict here exactly as it is there,
   * because both are statements about the account rather than about the caller.
   */
  async resendVerification(
    req: ResendAdminVerificationRequest
  ): Promise<ResendAdminVerificationResult> {
    const actorId = await this.gate.requireAdmin(req);
    return this.identity.resendVerificationAsOperator(
      req.targetUserId,
      actorId,
      req.locale
    );
  }

  /**
   * Every admin (plan 0074, section 5), oldest first.
   *
   * The read half of plan 0071 section 6, and permanently the only half. Ordered
   * by creation so the list does not reshuffle when somebody signs in, which a
   * `lastLoginAt` order would do on a screen whose whole purpose is recognising
   * that the set of rows has not changed.
   *
   * The columns are named rather than the entity selected, because `admin_users`
   * is the one table in this file that has a `passwordHash` on the row being
   * read.
   */
  async listAdmins(req: ListAdminsRequest): Promise<AdminIdentityListView> {
    await this.gate.requireAdmin(req);

    const rows = await this.admins.find({
      select: {
        id: true,
        username: true,
        displayName: true,
        lastLoginAt: true,
        disabledAt: true,
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return { admins: rows.map(toAdminView) };
  }
}

/**
 * A user row as the back office reads it. `kind` is passed through rather than
 * derived: whether somebody is a guest is a column, and inferring it from the
 * absence of an email would report the wrong thing for a registered user who has
 * only ever signed in with Google.
 */
function toUserView(user: User): AdminUserView {
  return {
    userId: user.id,
    kind: user.kind as UserKind,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toUserRef(user: User): AdminUserRefView {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
  };
}

function toAdminView(admin: AdminUser): AdminIdentityView {
  return {
    adminId: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    disabledAt: admin.disabledAt?.toISOString() ?? null,
  };
}
