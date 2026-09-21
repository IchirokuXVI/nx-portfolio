import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BasketKind,
  BASKET_SHARING_LIMITS,
  isOpenBasket,
  ParticipantEndedReason,
  ParticipantKind,
  type AddBasketParticipantRequest,
  type EnsureShareLinkRequest,
  type BasketJoinCoreResult,
  type BasketLinkPreview,
  type BasketParticipantContext,
  type BasketParticipantListResult,
  type BasketParticipantView,
  type BasketShareLinkResult,
  type BasketShareLinkView,
  type BasketShareRequest,
  type JoinBasketRequest,
  type LeaveBasketRequest,
  type ListParticipantsRequest,
  type ParticipantPresenceEntry,
  type PreviewShareLinkRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  NotAParticipantException,
  NotFoundException,
  ParticipantExpiredException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import {
  Basket,
  BasketParticipant,
  BasketShareLink,
} from '../entities';
import { BasketMembersService } from './basket-members.service';
import {
  hasEnded,
  liveLinkWhere,
  liveParticipantWhere,
} from './live-participant';
import {
  toParticipantView,
  toShareLinkView,
} from './basket-sharing.mappers';
import {
  NEXT_GUEST_NUMBER_SQL,
  WRITABLE_AMONG_SQL,
  type WritableAmongRow,
} from './basket-sharing.sql';

/**
 * Sharing a basket with people who have no account (plan 0051, sections 3, 4, 5
 * and 7).
 *
 * ## The one idea
 *
 * **A link is an invitation and a participant is an identity.** One link shared
 * with three people mints three participants, so an edit made in the shop is
 * attributed to a person rather than to a URL. Everything odd looking in this
 * file follows from that: two tables, two secrets stored two different ways,
 * three revoke gestures, and a per request check that reads the participant row
 * and never the link's.
 *
 * ## Why this is a second service rather than more of `BasketService`
 *
 * That one's `load(userId, id)` is plan 0050 section 8's owner only rule
 * expressed as a lookup: it filters on `ownerUserId` and answers not found rather
 * than forbidden. Widening it would silently widen every caller, including
 * `delete` and `update`, which stay owner only even after participants exist.
 * Two entry points asking two different questions is the honest shape, so this
 * file owns the participant resolving path and ends at the same public
 * `viewFor`.
 */
@Injectable()
export class BasketSharingService {
  private readonly cfg: CoreConfig['basket'];

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Basket)
    private readonly lists: Repository<Basket>,
    @InjectRepository(BasketShareLink)
    private readonly links: Repository<BasketShareLink>,
    @InjectRepository(BasketParticipant)
    private readonly participants: Repository<BasketParticipant>,
    // Adding people, the room check every door shares, and the announcements
    // every change of access makes (plan 0114).
    private readonly members: BasketMembersService,
    configService: ConfigService
  ) {
    // The two lifetimes of plan 0140, section 2. Read once here and spent as an
    // interval inside a statement, so the clock that decides them is the
    // database's rather than this process's.
    this.cfg = configService.getOrThrow<CoreConfig>('core').basket;
  }

  // --- The owner's share sheet ---------------------------------------------

  /**
   * The live link, minting one if there is none (plan 0051, section 3, as plan
   * 0140 section 4 amended it).
   *
   * **A link that expired is replaced rather than handed back.** That is what
   * this gained, and it is the failure plan 0140 opened on: the partial unique
   * index `uq_basket_share_links_live` cannot read a clock, so an
   * expired link still holds the one live slot, and freeing it is a write.
   * Without it, pressing share on a basket whose link ran out would hand back a
   * dead link.
   *
   * The write and the insert run in one transaction under the basket's lock,
   * which is what keeps two devices pressing share at once from racing through
   * the gap between them. The unique violation branch stays anyway, for the two
   * that reach the insert by some path the lock did not serialize.
   */
  async ensureLink(
    req: EnsureShareLinkRequest
  ): Promise<BasketShareLinkView> {
    const list = await this.loadOwned(req.userId, req.basketId);
    // Sharing is where the owner's row is minted, so it is where their account
    // name arrives, and an owner row that predates plan 0054 is backfilled here
    // (section 2.3).
    const owner = await this.ensureOwnerParticipant(list, req.username);

    const live = await this.liveLink(list.id);
    if (live) {
      return this.linkView(live);
    }

    try {
      const link = await this.dataSource.transaction(async (manager) => {
        await this.members.lock(manager, list.id);
        // Read again under the lock: another device may have minted one in the
        // gap, and that one is the live link.
        const winner = await manager.findOne(BasketShareLink, {
          where: { basketId: list.id, ...liveLinkWhere() },
        });
        if (winner) {
          return winner;
        }
        // Free the slot. Revoking an expired link **never cascades to its
        // people**: they carry their own expiry, and `revokeLink` with the
        // cascade is still the owner's gesture for throwing everybody out.
        await manager.query(
          `UPDATE "basket_share_links"
             SET "revokedAt" = now()
             WHERE "basketId" = $1 AND "revokedAt" IS NULL`,
          [list.id]
        );
        return this.mintLink(manager, list.id, owner.id);
      });
      return this.linkView(link);
    } catch (error) {
      // The index did its job: somebody else minted one between our read and our
      // insert, and theirs is the live link.
      if (isUniqueViolation(error)) {
        const winner = await this.liveLink(list.id);
        if (winner) {
          return this.linkView(winner);
        }
      }
      throw error;
    }
  }

  /**
   * Insert the link, with both of its moments from one clock (plan 0140,
   * section 4).
   *
   * Raw, so that `expiresAt` is computed as `now() + interval` inside the same
   * statement whose `createdAt` defaults to `now()`. Written through the entity
   * the two would come from two clocks, and the check constraint
   * `ck_basket_share_links_expiry` would be asserting something about a
   * pair that never agreed in the first place.
   */
  private async mintLink(
    manager: EntityManager,
    basketId: string,
    ownerParticipantId: string
  ): Promise<BasketShareLink> {
    const answered = await manager.query(
      `INSERT INTO "basket_share_links"
         ("basketId", "secret", "createdByParticipantId", "expiresAt", "revokedAt")
       VALUES ($1, $2, $3, now() + ($4::double precision * interval '1 millisecond'), NULL)
       RETURNING *`,
      [
        basketId,
        randomBytes(32).toString('base64url'),
        ownerParticipantId,
        this.cfg.linkTtlMs,
      ]
    );
    return returnedRows<BasketShareLink>(answered)[0];
  }

  /**
   * The live link if there is one, without minting.
   *
   * An absent `link` is the ordinary answer for a basket nobody has shared, not
   * an error: a basket has zero links or one (section 3), and both are states
   * rather than failures.
   *
   * A link whose twelve hours ran out is **no link** here (plan 0140,
   * section 4), which is the state the share sheet draws "Share" in. This read
   * does not revoke it: the write belongs to `ensureLink`, under the lock.
   */
  async getLink(
    req: BasketShareRequest
  ): Promise<BasketShareLinkResult> {
    const list = await this.loadOwned(req.userId, req.basketId);
    const live = await this.liveLink(list.id);
    return live ? { link: await this.linkView(live) } : {};
  }

  /**
   * Revoke the live link, optionally taking its guests with it (plan 0051,
   * section 3.4).
   *
   * The default is the case the plan is emphatic about: **stop it spreading, do
   * not throw out the people in the shop.** No new participant may be minted,
   * and every existing one keeps working, including opening the basket from that
   * same URL, because their session is what authorizes them and the link is only
   * an invitation they already accepted.
   *
   * With `revokeParticipants` the cascade writes `revokedAt` onto every
   * participant the link minted, which is why section 3.3's single lookup still
   * answers every case and the link table stays off the hot path.
   */
  async revokeLink(req: RevokeShareLinkRequest): Promise<{ revoked: number }> {
    const list = await this.loadOwned(req.userId, req.basketId);
    const live = await this.liveLink(list.id);
    if (!live) {
      // Revoking nothing is not an error: the sheet may simply be stale, and the
      // state the caller asked for is the state they are in.
      return { revoked: 0 };
    }

    const now = new Date();
    const evicted: BasketParticipant[] = [];
    await this.dataSource.transaction(async (manager) => {
      await manager.update(BasketShareLink, live.id, { revokedAt: now });
      if (!req.revokeParticipants) {
        return;
      }
      // The owner is never minted from a link, so a cascade cannot lock them out
      // of their own basket. Guests and registered joiners both go. A person the
      // owner added has no link on their row and stays (plan 0114, section 5),
      // including somebody who came by this link and was added afterwards.
      const minted = await manager.find(BasketParticipant, {
        where: { shareLinkId: live.id, ...liveParticipantWhere() },
      });
      for (const participant of minted) {
        await manager.update(BasketParticipant, participant.id, {
          revokedAt: now,
          endedReason: ParticipantEndedReason.LINK_REVOKED,
        });
        evicted.push(participant);
      }
    });

    for (const participant of evicted) {
      this.members.announceEnded(list.id, participant);
    }
    return { revoked: evicted.length };
  }

  /**
   * Revoke exactly one participant and nobody else (plan 0051, section 3.4): the
   * lost phone, and the guest who should not have been given it.
   */
  async revokeParticipant(
    req: RevokeParticipantRequest
  ): Promise<{ id: string }> {
    const list = await this.loadOwned(req.userId, req.basketId);
    const participant = await this.participants.findOne({
      where: { id: req.participantId, basketId: list.id },
    });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }
    if (participant.kind === ParticipantKind.OWNER) {
      // Not merely disallowed: it is incoherent. The owner's standing comes from
      // owning the basket, so a revoked owner row would be re created by the next
      // call to `ensureOwnerParticipant` and the gesture would look like it had
      // silently failed.
      throw new ValidationException('The owner cannot be revoked', {
        messageArgs: { field: 'participantId' },
      });
    }
    if (!participant.revokedAt) {
      participant.revokedAt = new Date();
      // The reason the link reads (plan 0114, section 7): a removed person may
      // not come back through it.
      participant.endedReason = ParticipantEndedReason.REMOVED;
      await this.participants.save(participant);
      this.members.announceEnded(list.id, participant);
    }
    return { id: participant.id };
  }

  /**
   * Add one of the owner's contacts to the basket (plan 0114, section 4), and
   * keep a link visitor (plan 0140, section 6).
   *
   * Owner only and not found for anybody else, like every gesture on the share
   * sheet. What happens to a row the person already has is the table on
   * {@link BasketMembersService.invite}.
   *
   * ## The contact rule is waived for somebody already on the basket
   *
   * Plan 0114 section 4 refuses anybody who shares no approved group with the
   * owner **now**, and the rule exists so that nobody is put on a basket by a
   * stranger who guessed a user id. A live link visitor is not that case: the
   * owner handed them the link, they are on the basket already, and since plan
   * 0140 keeping their access means being added by name, which a friend outside
   * every group of the owner's could otherwise never be.
   *
   * So the check runs on somebody with **no live row**, which is every case it
   * was written for, and on the owner themselves, whose own row is live and is
   * refused here rather than waived through. Their name is still resolved the
   * same way, because dropping the refusal is the whole of the waiver.
   *
   * The answer is the owner's view of the row, device string and join time
   * included, because the owner passes section 5.2 by construction. The room
   * hears the least privileged view, and only when the row became live.
   */
  async addParticipant(
    req: AddBasketParticipantRequest
  ): Promise<BasketParticipantView> {
    const list = await this.loadOwned(req.userId, req.basketId);
    const live = await this.participants.findOne({
      where: {
        basketId: list.id,
        userId: req.memberUserId,
        ...liveParticipantWhere(),
      },
    });
    const waived = live !== null && live.kind !== ParticipantKind.OWNER;
    const common = waived
      ? await this.members.commonGroups(list.ownerUserId, [req.memberUserId])
      : await this.members.requireContacts(
          list.ownerUserId,
          [req.memberUserId],
          'userId'
        );
    const username = this.members.nameFor(
      common.get(req.memberUserId),
      req.globalUsername
    );

    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.members.lock(manager, list.id);
      return this.members.invite(manager, {
        basketId: list.id,
        userId: req.memberUserId,
        invitedByUserId: req.userId,
        username,
      });
    });

    if (outcome.becameLive) {
      this.members.announceLive(list.id, outcome.participant);
    }
    return toParticipantView(outcome.participant, true);
  }

  /**
   * Leave a basket (plan 0114, section 6), as the participant the gateway's
   * guard resolved.
   *
   * A registered participant only. A guest's place on a basket is the link's to
   * give and the owner's to take away, and the plan leaves it there. The owner's
   * standing comes from owning the basket, which no row can give up.
   *
   * Leaving is the one ending the link can undo: the reason written here is what
   * lets the same person join again through it (section 7).
   */
  async leave(req: LeaveBasketRequest): Promise<{ id: string }> {
    const participant = await this.liveParticipantById(
      req.participantId,
      req.basketId
    );
    if (!participant) {
      throw new NotAParticipantException('Not a participant of this basket');
    }
    if (participant.kind === ParticipantKind.GUEST) {
      throw new ForbiddenException('A guest cannot leave a basket');
    }
    if (participant.kind === ParticipantKind.OWNER) {
      throw new ValidationException('The owner cannot leave their own basket', {
        messageArgs: { field: 'participantId' },
      });
    }
    participant.revokedAt = new Date();
    participant.endedReason = ParticipantEndedReason.LEFT;
    await this.participants.save(participant);
    this.members.announceEnded(req.basketId, participant);
    return { id: participant.id };
  }

  // --- Joining --------------------------------------------------------------

  /**
   * What the join screen may know before anybody joins (plan 0051, section 4,
   * step 1).
   *
   * **It leaks nothing and it never fails.** No lines, no zone names, no list
   * names, no member names: somebody who finds a link in a chat log learns that a
   * shopping list exists and nothing else.
   *
   * A link that never existed, one that was revoked, one that expired and one
   * whose basket has been completed all answer `joinable: false` and nothing
   * more. That is what reconciles section 3.1, which wants a dead link and a
   * fictional one to get the same answer, with section 4, which wants the screen
   * to be able to say "this link is no longer accepting people". Answering 404
   * for one and 200 for the other would satisfy the second and quietly break the
   * first.
   */
  async preview(
    req: PreviewShareLinkRequest
  ): Promise<BasketLinkPreview> {
    const link = await this.acceptingLink(req.secret);
    if (!link) {
      return { joinable: false };
    }
    const list = await this.lists.findOne({
      where: { id: link.basketId },
    });
    if (!list || !this.listAccepts(list)) {
      return { joinable: false };
    }
    return {
      joinable: true,
      // Null for the permanent basket, which has no name (plan 0133). That
      // leaks nothing, and the client is what words it.
      name: list.name,
      participantCount: await this.participants.count({
        where: { basketId: list.id, ...liveParticipantWhere() },
      }),
    };
  }

  /**
   * Mint a participant from a link, or attach a registered caller (plan 0051,
   * section 4, steps 2 and 3).
   *
   * A guest gets a session secret, returned **once** and stored hashed, and the
   * next `guestNumber` when they send no name. A caller presenting a valid
   * account token is attached as `REGISTERED` instead, with no name prompt, and
   * the partial unique index over (`basketId`, `userId`) makes a second
   * link they open resolve to the row they already have.
   *
   * **Everybody a link lets in gets an expiry** (plan 0140, section 5), twelve
   * hours from their own join, guest and signed in alike. "Never binds to an
   * account" does not mean "writes no row": every settle and every change
   * record names a participant, so the row is still written and still keyed by
   * their user id. What changes is that it ends by itself, and only the owner
   * adding them by name makes it stay.
   */
  async join(
    req: JoinBasketRequest
  ): Promise<BasketJoinCoreResult> {
    const link = await this.acceptingLink(req.secret);
    if (!link) {
      // The same answer the preview gives, for the same reason: a revoked link,
      // an expired one and one that never existed must not be distinguishable.
      throw new NotFoundException('This link is no longer accepting people');
    }
    const list = await this.lists.findOne({
      where: { id: link.basketId },
    });
    if (!list || !this.listAccepts(list)) {
      throw new NotFoundException('This link is no longer accepting people');
    }

    // The owner opening their own link is the owner, not a second identity.
    if (req.userId && req.userId === list.ownerUserId) {
      const owner = await this.ensureOwnerParticipant(list, req.username);
      return {
        basketId: list.id,
        participant: this.view(owner),
        sessionSecret: null,
      };
    }

    if (req.userId) {
      const existing = await this.participants.findOne({
        where: { basketId: list.id, userId: req.userId },
      });
      if (existing) {
        return this.rejoin(list, link, existing, req);
      }
    }
    // A guest whose access expired is a **new guest** (plan 0140, section 5).
    // A guest has no identity to find a row by, so there is no branch above
    // this one for them: a fresh link mints a fresh row with the next guest
    // number, and their old secret answers `participant_expired`.

    const displayName = normalizeDisplayName(req.displayName);
    const sessionSecret = req.userId
      ? null
      : randomBytes(32).toString('base64url');

    let participant: BasketParticipant;
    try {
      participant = await this.mint(
        list,
        link,
        req,
        displayName,
        sessionSecret
      );
    } catch (error) {
      // Two first joins by one person at once (plan 0114, section 11). The lock
      // serializes the inserts, but the lookup above ran before it, so the
      // second join reaches the insert and loses the unique index. The row it
      // lost to is the first join's, and section 7's table says what it means.
      if (req.userId && isUniqueViolation(error)) {
        const winner = await this.participants.findOne({
          where: { basketId: list.id, userId: req.userId },
        });
        if (winner) {
          return this.rejoin(list, link, winner, req);
        }
      }
      throw error;
    }

    this.members.announceLive(list.id, participant);
    return {
      basketId: list.id,
      participant: this.view(participant),
      sessionSecret,
    };
  }

  /**
   * Write a new participant row from a link, under the basket's lock.
   *
   * **The expiry is part of the insert and cannot be a second statement.**
   * `ck_basket_participants_expiry` says a row that is neither the
   * owner's nor invited always carries one, so a row written with a null and
   * stamped afterwards is refused by the constraint that makes the rule true.
   * The moment is read from the database inside this transaction, so the clock
   * is still the database's (plan 0140, section 5).
   */
  private mint(
    list: Basket,
    link: BasketShareLink,
    req: JoinBasketRequest,
    displayName: string | null,
    sessionSecret: string | null
  ): Promise<BasketParticipant> {
    return this.dataSource.transaction(async (manager) => {
      // Serializes concurrent joins on this basket, which is what lets the guest
      // number below be a `max + 1` rather than a sequence (see the SQL).
      await this.members.lock(manager, list.id);
      await this.members.checkRoom(manager, list.id);

      let guestNumber: number | null = null;
      if (!req.userId) {
        const [row] = await manager.query<{ next: string }[]>(
          NEXT_GUEST_NUMBER_SQL,
          [list.id]
        );
        guestNumber = Number(row?.next ?? 1);
      }

      const now = await this.databaseNow(manager);
      return manager.save(
        manager.create(BasketParticipant, {
          basketId: list.id,
          shareLinkId: link.id,
          kind: req.userId ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
          userId: req.userId ?? null,
          displayName,
          // A guest never carries one however the message was filled in: there
          // is no account behind them for it to be the name of.
          username: req.userId ? normalizeUsername(req.username) : null,
          guestNumber,
          sessionSecretHash: sessionSecret ? hashSecret(sessionSecret) : null,
          userAgent: normalizeUserAgent(req.userAgent),
          joinedAt: now,
          lastSeenAt: now,
          revokedAt: null,
          endedReason: null,
          invitedAt: null,
          invitedByUserId: null,
          // Everybody a link lets in, guest and signed in alike (section 5).
          // The owner never reaches here: `join` answers them before this.
          expiresAt: this.sessionEnd(now),
        })
      );
    });
  }

  /** Twelve hours after a moment the database gave us (section 2). */
  private sessionEnd(now: Date): Date {
    return new Date(now.getTime() + this.cfg.linkSessionTtlMs);
  }

  /**
   * Push a **live** visitor's `expiresAt` out to `now() + the session ttl`, or
   * leave it where it is if it is already further away (plan 0140, section 5).
   *
   * `GREATEST`, so a live visitor opening a second link never shortens their
   * access: the link they already hold gave them a window, and a shorter one
   * cannot take it back. One statement rather than a read and a write, so two
   * links opened at once cannot both read the old value.
   *
   * Only for a row that already carries an expiry. A row being written or
   * revived takes its expiry in the same statement as everything else, because
   * the check constraint refuses a link visitor with a null one.
   */
  private async stampExpiry(
    manager: EntityManager,
    participant: BasketParticipant
  ): Promise<BasketParticipant> {
    const answered = await manager.query(
      `UPDATE "basket_participants"
         SET "expiresAt" = GREATEST(
               COALESCE("expiresAt", now()),
               now() + ($2::double precision * interval '1 millisecond')
             )
         WHERE id = $1
       RETURNING *`,
      [participant.id, this.cfg.linkSessionTtlMs]
    );
    return returnedRows<BasketParticipant>(answered)[0];
  }

  /**
   * A registered person opening a link while they already have a row on this
   * basket (plan 0114, section 7, as plan 0140 section 5 extended it).
   *
   * | Their row                                       | Result                                                |
   * | ----------------------------------------------- | ----------------------------------------------------- |
   * | live, a named person                            | unchanged, and `expiresAt` stays null                 |
   * | live, a link visitor                            | their expiry is pushed out, this link holds them      |
   * | ended with `LEFT`                               | brought back by the link, now with an expiry          |
   * | ended with `EXPIRED`, or past its expiry        | brought back, same row, same id, a new expiry         |
   * | ended with `REMOVED` or `LINK_REVOKED`          | refused with 401                                      |
   *
   * Leaving was the person's own choice, so the link they still hold may undo
   * it, and **running out of time was nobody's choice at all**: `EXPIRED` joins
   * `LEFT` as a reason the link can undo, because nobody refused them. A removal
   * and a revoked link were the owner's, and the link is not a way round either:
   * section 3.4's revoke would mean nothing if it were.
   *
   * **A link never turns a named person into a visitor.** The owner's gesture
   * outranks the link, so a row with `invitedAt` set keeps its null expiry and
   * keeps its null `shareLinkId`, however many links that person opens.
   *
   * The row is the same one throughout, which the unique index over
   * (`basketId`, `userId`) makes true, and that is what keeps somebody's
   * past purchases attributed to one participant across visits.
   */
  private async rejoin(
    list: Basket,
    link: BasketShareLink,
    existing: BasketParticipant,
    req: JoinBasketRequest
  ): Promise<BasketJoinCoreResult> {
    // Every branch below asks whether this row has ended, and an expiry the
    // sweep has not reached yet is ended. One `now`, read from the database, so
    // this process's clock decides nothing.
    const now = await this.databaseNow();
    if (!hasEnded(existing, now)) {
      return this.refreshLiveRow(list, link, existing, req);
    }
    if (!canReturnByLink(existing, now)) {
      throw new NotAParticipantException(
        'This link is no longer available to you'
      );
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      await this.members.lock(manager, list.id);
      // Read again under the lock: another tab may have brought them back
      // already, or the owner may have removed them since the read above.
      const row = await manager.findOne(BasketParticipant, {
        where: { id: existing.id },
      });
      if (!row) {
        throw new NotFoundException('This link is no longer accepting people');
      }
      const inTx = await this.databaseNow(manager);
      if (!hasEnded(row, inTx)) {
        return { row, becameLive: false };
      }
      if (!canReturnByLink(row, inTx)) {
        throw new NotAParticipantException(
          'This link is no longer available to you'
        );
      }
      await this.members.checkRoom(manager, list.id);

      row.revokedAt = null;
      row.endedReason = null;
      // Back by the link, so the link holds them again: revoking it with its
      // people reaches them, as it reaches anybody else it let in.
      row.shareLinkId = link.id;
      row.invitedAt = null;
      row.invitedByUserId = null;
      row.joinedAt = inTx;
      row.lastSeenAt = inTx;
      row.userAgent = normalizeUserAgent(req.userAgent) ?? row.userAgent;
      row.username ??= normalizeUsername(req.username);
      // A fresh window from this join. The old one is in the past by
      // definition, since that is what brought them down this branch, and the
      // constraint refuses the null a two step write would pass through.
      row.expiresAt = this.sessionEnd(inTx);
      return { row: await manager.save(row), becameLive: true };
    });

    if (outcome.becameLive) {
      this.members.announceLive(list.id, outcome.row);
    }
    return {
      basketId: list.id,
      participant: this.view(outcome.row),
      sessionSecret: null,
    };
  }

  /**
   * A live row opening a link again (plan 0140, section 5, the first two rows
   * of the rejoin table).
   *
   * A named person is touched for their last seen time and nothing else: their
   * expiry stays null and no link takes hold of them. A link visitor has their
   * window pushed out and this link recorded, so revoking it with its people
   * reaches them.
   */
  private async refreshLiveRow(
    list: Basket,
    link: BasketShareLink,
    existing: BasketParticipant,
    req: JoinBasketRequest
  ): Promise<BasketJoinCoreResult> {
    existing.lastSeenAt = new Date();
    // Filled in when it is missing and left alone when it is not (plan
    // 0054, section 2.4). A name already on the row is a snapshot taken when
    // they joined, and somebody who has since renamed their account keeps
    // the old one on baskets they are already on; a null is a row from
    // before the plan, which is repair rather than a rename.
    existing.username ??= normalizeUsername(req.username);
    const named =
      existing.kind === ParticipantKind.OWNER || existing.invitedAt !== null;
    if (!named) {
      existing.shareLinkId = link.id;
    }
    let row = await this.participants.save(existing);
    if (!named) {
      row = await this.stampExpiry(this.dataSource.manager, row);
    }
    return {
      basketId: list.id,
      participant: this.view(row),
      sessionSecret: null,
    };
  }

  // --- The hot path ---------------------------------------------------------

  /**
   * Turn a presented credential into a participant (plan 0051, section 3.3).
   *
   * **One indexed lookup**, reading `revokedAt` on the row it finds, with no
   * cache, because revocation has to bite immediately and this is a single index
   * read. The link's state is never consulted, which is exactly what lets
   * section 3.4 revoke a link without evicting the people already shopping.
   *
   * It carries no `seesZoneData` since plan 0136 (section 3.4). That flag was
   * all or nothing over every source list of the run, and a `LIVE` basket covers
   * every list its owner can write, so "every source list" is not a set a second
   * reader can be measured against at all. What replaced it is per list and is
   * answered by the basket read, which knows the coverage.
   *
   * Since plan 0140 the row's `expiresAt` is part of "live", and an expired
   * caller is told so rather than told they are not a participant (section 8).
   * The second lookup that decides which sentence they get runs **only** on the
   * failure, so the successful path is still the one indexed read.
   */
  async resolveParticipant(
    req: ResolveParticipantRequest
  ): Promise<BasketParticipantContext> {
    const participant = await this.findLiveParticipant(req);
    if (!participant) {
      throw await this.refusal(req);
    }

    // Cheap and useful: presence and the share sheet both show it, and it costs
    // one write on a row already in the buffer pool.
    await this.participants.update(participant.id, { lastSeenAt: new Date() });

    return {
      participantId: participant.id,
      basketId: participant.basketId,
      kind: participant.kind,
      userId: participant.userId,
    };
  }

  /**
   * Whether this participant is still live on this basket (plan 0051,
   * section 7), for the socket room check and the eviction sweep.
   *
   * Keyed by participant id rather than by a credential, because that is what a
   * socket's token carries. The basket is part of the question rather than
   * assumed from the id, so a participant of one basket can never be admitted to
   * another's room by an id that happens to be valid somewhere.
   */
  async isParticipantLive(
    participantId: string,
    basketId: string
  ): Promise<boolean> {
    const count = await this.participants.count({
      where: { id: participantId, basketId, ...liveParticipantWhere() },
    });
    return count > 0;
  }

  /**
   * The same check, answering with who they are rather than merely whether they
   * are (plan 0051, section 7).
   *
   * What the socket admission actually needs: one read decides both whether to
   * let them in and what to put in the presence room for them. The name is read
   * here rather than carried in the token because a guest can rename themselves
   * and a token minted beforehand would pin the old name for its whole life.
   *
   * `userAgent` is deliberately not in this entry. Section 7 is explicit that the
   * device string is not presence data: it is shown on tap, from the participant
   * list, to readers who pass section 5.2, and a broadcast would hand it to every
   * guest in the shop.
   *
   * It answers the **basket's** kind beside the participant since plan 0139
   * section 6, because that is what decides whether the socket enters presence at
   * all: a `LIVE` basket is the one everybody holds all the time, so "somebody is
   * here" on it says nothing and a presence room per person is a Redis key that
   * never expires. It rides on this admission rather than on a call of its own,
   * for the reason the entry itself does: admitting a socket is already a round
   * trip and the answer is wanted in the same breath.
   */
  async livePresenceEntry(
    participantId: string,
    basketId: string
  ): Promise<LiveParticipantAdmission | null> {
    const participant = await this.participants.findOne({
      where: { id: participantId, basketId, ...liveParticipantWhere() },
    });
    if (!participant) {
      return null;
    }
    // Read only once the participant is known live, so a socket with no business
    // on the basket costs one query rather than two.
    const basket = await this.lists.findOne({
      where: { id: basketId },
      select: { id: true, kind: true },
    });
    if (!basket) {
      // The participant row cascades with its basket, so this is unreachable in
      // one transaction's worth of time. Refusing beats admitting a socket to
      // the room of a basket that is not there.
      return null;
    }
    return {
      entry: {
        participantId: participant.id,
        kind: participant.kind,
        displayName: participant.displayName,
        guestNumber: participant.guestNumber,
        userId: participant.userId,
      },
      basketKind: basket.kind,
    };
  }

  /**
   * One live participant by id, on this basket (plan 0051, section 3.3).
   *
   * The row itself rather than {@link livePresenceEntry}'s projection, because
   * the callers that need it go on to ask about the participant's account: the
   * basket's redaction is per list and reads `userId`, and the read composes the
   * whole row into its answer.
   *
   * The basket is part of the lookup rather than assumed from the id, on the same
   * reasoning as {@link isParticipantLive}: a participant of one basket must
   * never be admitted to another's by an id that happens to be valid somewhere.
   */
  async liveParticipantById(
    participantId: string,
    basketId: string
  ): Promise<BasketParticipant | null> {
    return this.participants.findOne({
      where: { id: participantId, basketId, ...liveParticipantWhere() },
    });
  }

  /** The participant behind a presented credential, or null. Live rows only. */
  async findLiveParticipant(
    req: ResolveParticipantRequest
  ): Promise<BasketParticipant | null> {
    if (req.sessionSecret) {
      const participant = await this.participants.findOne({
        where: {
          sessionSecretHash: hashSecret(req.sessionSecret),
          ...liveParticipantWhere(),
        },
      });
      // The secret identifies the row on its own, so the basket it names is
      // checked rather than trusted: a secret for another basket is not a
      // credential for this one.
      return participant && participant.basketId === req.basketId
        ? participant
        : null;
    }
    if (req.userId) {
      const participant = await this.participants.findOne({
        where: {
          basketId: req.basketId,
          userId: req.userId,
          ...liveParticipantWhere(),
        },
      });
      if (participant) {
        return participant;
      }
      // An owner who has never been through a link still has a participant row,
      // lazily, which is what makes a basket generated before this plan
      // shareable rather than permanently unshareable.
      const list = await this.lists.findOne({
        where: { id: req.basketId, ownerUserId: req.userId },
      });
      return list ? await this.ensureOwnerParticipant(list) : null;
    }
    return null;
  }

  /** Which of `listIds` this person may write, at request time (section 5.2). */
  async writableAmong(
    userId: string,
    listIds: readonly string[]
  ): Promise<Set<string>> {
    if (listIds.length === 0) {
      return new Set();
    }
    const rows = await this.lists.query<WritableAmongRow[]>(
      WRITABLE_AMONG_SQL,
      [userId, [...listIds]]
    );
    return new Set(rows.map((row) => row.listId));
  }

  /** The distinct zone lists a basket's provenance rows point at. */
  // --- Reading the people ---------------------------------------------------

  /**
   * Everybody on a basket (plan 0051, sections 3 and 7).
   *
   * `userAgent` is included only for a reader who passes section 5.2, which is
   * section 7's rule that the device string is not presence data: it is shown on
   * tap, and guests do not get to inspect each other.
   */
  async listParticipants(
    req: ListParticipantsRequest
  ): Promise<BasketParticipantListResult> {
    // The second place a name can reach the owner's row (plan 0054,
    // section 2.3). The share sheet reads this, and it reads it whether or not
    // anybody has pressed share, so an owner who has never minted a link is
    // still named on the screen that lists them. Only the account authenticated
    // route carries a `userId`, so the participant surface never lands here.
    if (req.userId) {
      const owned = await this.lists.findOne({
        where: { id: req.basketId, ownerUserId: req.userId },
      });
      if (owned) {
        await this.ensureOwnerParticipant(owned, req.username);
      }
    }

    const rows = await this.participants.find({
      where: {
        basketId: req.basketId,
        ...liveParticipantWhere(),
      },
      order: { joinedAt: 'ASC' },
    });

    let withDevices = true;
    if (req.asParticipantId) {
      const asker = rows.find((row) => row.id === req.asParticipantId);
      // Who may inspect the people on a basket, since plan 0136 deleted
      // `seesZoneData`. The same rule as the shop addresses and for the same
      // reason: when somebody arrived and what device they are on is a fact
      // about **them** rather than about any list, so no list's permissions can
      // decide it. The owner and the people they named see it; a link visitor,
      // guest or registered, does not.
      withDevices = asker
        ? asker.kind === ParticipantKind.OWNER || asker.invitedAt !== null
        : false;
    }
    return {
      participants: rows.map((row) => toParticipantView(row, withDevices)),
    };
  }

  /**
   * The owner's participant row, created if it is missing (plan 0051,
   * section 3.2).
   *
   * The plan says the owner gets a row "at generation time". This creates it
   * lazily instead, and the difference is deliberate: the row's *existence* is
   * what every attribution column needs, and doing it here rather than in
   * `BasketService.create` means a basket generated before this plan
   * shipped is shareable too, instead of being permanently unshareable for want
   * of a row nobody can add.
   *
   * Idempotent by the same partial unique index that serves registered joiners,
   * so two concurrent first shares cannot mint two owner rows.
   */
  async ensureOwnerParticipant(
    list: Basket,
    username?: string | null
  ): Promise<BasketParticipant> {
    const name = normalizeUsername(username);
    const existing = await this.participants.findOne({
      where: { basketId: list.id, userId: list.ownerUserId },
    });
    if (existing) {
      // The backfill plan 0054 section 2.3 asks for, and it is the same lazy
      // repair this method already is: an owner row minted before that plan has
      // no name, nothing else can supply one, and the two calls that carry a
      // name are the two an owner makes on their own basket. Only a null is
      // filled, so a name taken at join time is never quietly replaced by a
      // later one (section 2.4).
      if (name && !existing.username) {
        existing.username = name;
        await this.participants.save(existing);
      }
      return existing;
    }
    try {
      return await this.participants.save(
        this.participants.create({
          basketId: list.id,
          shareLinkId: null,
          kind: ParticipantKind.OWNER,
          userId: list.ownerUserId,
          displayName: null,
          username: name,
          guestNumber: null,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt: list.generatedAt ?? new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          // The owner never expires (plan 0140, section 2), which
          // `ck_basket_participants_expiry` holds rather than merely
          // hopes: their standing comes from owning the basket, and a clock
          // cannot take that away.
          expiresAt: null,
        })
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.participants.findOne({
          where: { basketId: list.id, userId: list.ownerUserId },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** Attribute an edit or a settle to whoever made it (plan 0051, section 8). */
  attribution(participantId: string): {
    lastEditedByParticipantId: string;
    lastEditedAt: Date;
  } {
    return {
      lastEditedByParticipantId: participantId,
      lastEditedAt: new Date(),
    };
  }

  // --- Internals ------------------------------------------------------------

  /** One basket of this caller's, or not found. Never forbidden (0050, s8). */
  private async loadOwned(
    userId: string,
    basketId: string
  ): Promise<Basket> {
    const list = await this.lists.findOne({
      where: { id: basketId, ownerUserId: userId },
    });
    if (!list) {
      throw new NotFoundException('Basket not found');
    }
    return list;
  }

  /**
   * The basket's link, if it is still live: not revoked and not past its twelve
   * hours (plan 0140, section 4).
   *
   * The expiry is read in SQL rather than compared here, so the database's clock
   * decides it, and an expired link is simply absent to every reader. Revoking
   * it, which is what frees the slot the partial unique index holds, is
   * `ensureLink`'s write under the lock.
   */
  private liveLink(
    basketId: string
  ): Promise<BasketShareLink | null> {
    return this.links.findOne({
      where: { basketId, ...liveLinkWhere() },
    });
  }

  /**
   * The link behind a presented secret, if it may still let somebody in.
   *
   * One lookup where plan 0051 had a lookup and an in memory comparison, which
   * is what puts the expiry on the database's clock (plan 0140, the one clock
   * constraint). A revoked link, an expired one and one that never existed are
   * all **null** here, which is exactly what keeps them indistinguishable to
   * the unauthenticated preview and join (plan 0051, section 3.1).
   */
  private acceptingLink(
    secret: string
  ): Promise<BasketShareLink | null> {
    return this.links.findOne({ where: { secret, ...liveLinkWhere() } });
  }

  /** The database's clock, which is the only one that decides an expiry. */
  private async databaseNow(manager?: EntityManager): Promise<Date> {
    const [row] = await (manager ?? this.dataSource.manager).query<
      { now: Date }[]
    >(`SELECT now() AS "now"`);
    return row.now;
  }

  /**
   * Which refusal a caller whose credential named no live participant gets
   * (plan 0140, section 8).
   *
   * A second lookup, made **only** on the failure, so the hot path is untouched.
   * A caller whose own row ended by the clock is told so; everybody else keeps
   * `not_a_participant`, which is what a removal and a revoked link still say.
   */
  private async refusal(req: ResolveParticipantRequest): Promise<Error> {
    const row = await this.endedRow(req);
    if (row && (await this.expiredByClock(row))) {
      return new ParticipantExpiredException(
        'Your access to this basket has ended'
      );
    }
    return new NotAParticipantException('Not a participant of this basket');
  }

  /** The caller's row on this basket whatever state it is in, or null. */
  private async endedRow(
    req: ResolveParticipantRequest
  ): Promise<BasketParticipant | null> {
    if (req.sessionSecret) {
      const row = await this.participants.findOne({
        where: { sessionSecretHash: hashSecret(req.sessionSecret) },
      });
      return row && row.basketId === req.basketId ? row : null;
    }
    if (req.userId) {
      return this.participants.findOne({
        where: { basketId: req.basketId, userId: req.userId },
      });
    }
    return null;
  }

  /** Ended by the clock rather than by a person, on the database's clock. */
  private async expiredByClock(
    row: BasketParticipant
  ): Promise<boolean> {
    if (row.endedReason === ParticipantEndedReason.EXPIRED) {
      return true;
    }
    if (row.revokedAt) {
      // Removed, or revoked with the link. A person said so, and saying "your
      // time ran out" would be a different sentence about a different thing.
      return false;
    }
    // Past its expiry and not yet swept, which HTTP already refuses.
    return hasEnded(row, await this.databaseNow());
  }

  /**
   * Whether a basket may still take people (plan 0051, section 11's leaning).
   *
   * A finished or archived basket stops accepting them, because an
   * unauthenticated read of somebody's shopping habits should not outlive the
   * trip. It does **not** evict the people already on it, on exactly the reasoning
   * section 3.4 applies to a revoked link.
   *
   * It asks the status alone and not the kind (plan 0133). The permanent basket
   * is always open, so it always accepts, and that is right: plan 0114 shares a
   * basket with a named person, and the one that is always there is the one worth
   * sharing standing.
   */
  private listAccepts(list: Basket): boolean {
    return isOpenBasket(list.status);
  }

  private async linkView(
    link: BasketShareLink
  ): Promise<BasketShareLinkView> {
    const participantCount = await this.participants.count({
      where: { shareLinkId: link.id, ...liveParticipantWhere() },
    });
    return toShareLinkView(link, participantCount);
  }

  private view(
    participant: BasketParticipant
  ): BasketParticipantView {
    return toParticipantView(participant, false);
  }
}

/**
 * Whether an ended row may be brought back by a link (plan 0140, section 5).
 *
 * `LEFT` was the person's own choice and `EXPIRED` was nobody's, so a link may
 * undo both. `REMOVED` and `LINK_REVOKED` were the owner's, and a link is not a
 * way round either. A row past its expiry that the sweep has not reached yet
 * carries no reason at all, and reads as expired.
 */
function canReturnByLink(
  row: BasketParticipant,
  now: Date
): boolean {
  if (!row.revokedAt) {
    // Ended only by the clock, so the sweep has simply not got to it.
    return hasEnded(row, now);
  }
  return (
    row.endedReason === ParticipantEndedReason.LEFT ||
    row.endedReason === ParticipantEndedReason.EXPIRED
  );
}

/**
 * The rows of a `RETURNING`, whichever shape the driver hands them back in.
 *
 * The trap `basket.sql.ts` records: what TypeORM's `query` answers for an
 * `UPDATE ... RETURNING` is not the plain row array a `SELECT` gives. This
 * driver answers `[rows, rowCount]`, so reading the first element straight off
 * it yields an array where a row was expected, every field reads `undefined`,
 * and nothing fails. Measured rather than assumed, and unwrapped here rather
 * than trusted.
 */
function returnedRows<T>(answered: unknown): T[] {
  if (Array.isArray(answered) && Array.isArray(answered[0])) {
    return answered[0] as T[];
  }
  return (Array.isArray(answered) ? answered : []) as T[];
}

/** Postgres unique-violation, raised by the two partial indexes above. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** SHA-256, matching how auth stores a refresh token: a hash, not a cipher. */
function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Trimmed and capped, and an empty name is **no** name rather than an empty one,
 * so a guest who submits whitespace gets "Guest N" like anybody who skipped it.
 */
function normalizeDisplayName(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, BASKET_SHARING_LIMITS.displayNameMaxLength);
}

/**
 * An account's own name, trimmed and capped to the same width a typed one has
 * (plan 0054, section 2.3).
 *
 * Empty is **no** name rather than an empty one, for the reason
 * {@link normalizeDisplayName} says so: a row carrying an empty string would
 * draw a nameless face rather than falling back to whatever the client draws
 * when there is nothing to show.
 */
function normalizeUsername(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, BASKET_SHARING_LIMITS.displayNameMaxLength);
}

/**
 * What one admission of a participant socket answers (plan 0139, section 6).
 *
 * Who they are, for the presence room, and what kind of basket it is, which
 * decides whether there is a presence room for them to enter.
 */
export interface LiveParticipantAdmission {
  entry: ParticipantPresenceEntry;
  basketKind: BasketKind;
}

/** Capped to the column width; a header is attacker controlled and unbounded. */
function normalizeUserAgent(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 400) : null;
}
