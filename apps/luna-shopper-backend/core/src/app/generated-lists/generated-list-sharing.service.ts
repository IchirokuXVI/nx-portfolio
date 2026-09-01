import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GENERATED_LIST_SHARING_LIMITS,
  GeneratedListStatus,
  ParticipantKind,
  RealtimeEvent,
  type EnsureShareLinkRequest,
  type GeneratedListJoinCoreResult,
  type GeneratedListLinkPreview,
  type GeneratedListParticipantContext,
  type GeneratedListParticipantListResult,
  type GeneratedListParticipantView,
  type GeneratedListShareLinkResult,
  type GeneratedListShareLinkView,
  type GeneratedListShareRequest,
  type JoinGeneratedListRequest,
  type ListParticipantsRequest,
  type ParticipantPresenceEntry,
  type PreviewShareLinkRequest,
  type ResolveParticipantRequest,
  type RevokeParticipantRequest,
  type RevokeShareLinkRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  GeneratedList,
  GeneratedListParticipant,
  GeneratedListShareLink,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import {
  BASKET_SOURCE_LISTS_SQL,
  NEXT_GUEST_NUMBER_SQL,
  WRITABLE_AMONG_SQL,
  type BasketSourceListRow,
  type WritableAmongRow,
} from './generated-list-sharing.sql';
import {
  toParticipantView,
  toShareLinkView,
} from './generated-list-sharing.mappers';

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
 * ## Why this is a second service rather than more of `GeneratedListService`
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
export class GeneratedListSharingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GeneratedList)
    private readonly lists: Repository<GeneratedList>,
    @InjectRepository(GeneratedListShareLink)
    private readonly links: Repository<GeneratedListShareLink>,
    @InjectRepository(GeneratedListParticipant)
    private readonly participants: Repository<GeneratedListParticipant>,
    private readonly events: CoreEventsPublisher
  ) {}

  // --- The owner's share sheet ---------------------------------------------

  /**
   * The live link, minting one if there is none (plan 0051, section 3).
   *
   * Idempotent by the partial unique index rather than by a check: pressing share
   * twice from two devices races, one insert loses on
   * `uq_generated_list_share_links_live`, and the loser re reads instead of
   * creating a second live link. A service level guard could not promise that
   * without a lock.
   */
  async ensureLink(
    req: EnsureShareLinkRequest
  ): Promise<GeneratedListShareLinkView> {
    const list = await this.loadOwned(req.userId, req.generatedListId);
    const owner = await this.ensureOwnerParticipant(list);

    const live = await this.liveLink(list.id);
    if (live) {
      return this.linkView(live);
    }

    const expiresAt = this.resolveExpiry(req.expiresAt);
    try {
      const link = await this.links.save(
        this.links.create({
          generatedListId: list.id,
          secret: randomBytes(32).toString('base64url'),
          createdByParticipantId: owner.id,
          expiresAt,
          revokedAt: null,
        })
      );
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
   * The live link if there is one, without minting.
   *
   * An absent `link` is the ordinary answer for a basket nobody has shared, not
   * an error: a basket has zero links or one (section 3), and both are states
   * rather than failures.
   */
  async getLink(
    req: GeneratedListShareRequest
  ): Promise<GeneratedListShareLinkResult> {
    const list = await this.loadOwned(req.userId, req.generatedListId);
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
    const list = await this.loadOwned(req.userId, req.generatedListId);
    const live = await this.liveLink(list.id);
    if (!live) {
      // Revoking nothing is not an error: the sheet may simply be stale, and the
      // state the caller asked for is the state they are in.
      return { revoked: 0 };
    }

    const now = new Date();
    const evicted: GeneratedListParticipant[] = [];
    await this.dataSource.transaction(async (manager) => {
      await manager.update(GeneratedListShareLink, live.id, { revokedAt: now });
      if (!req.revokeParticipants) {
        return;
      }
      // The owner is never minted from a link, so a cascade cannot lock them out
      // of their own basket. Guests and registered joiners both go.
      const minted = await manager.find(GeneratedListParticipant, {
        where: { shareLinkId: live.id, revokedAt: IsNull() },
      });
      for (const participant of minted) {
        await manager.update(GeneratedListParticipant, participant.id, {
          revokedAt: now,
        });
        evicted.push(participant);
      }
    });

    for (const participant of evicted) {
      this.announceLeft(list.id, participant);
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
    const list = await this.loadOwned(req.userId, req.generatedListId);
    const participant = await this.participants.findOne({
      where: { id: req.participantId, generatedListId: list.id },
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
      await this.participants.save(participant);
      this.announceLeft(list.id, participant);
    }
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
  ): Promise<GeneratedListLinkPreview> {
    const link = await this.links.findOne({
      where: { secret: req.secret },
    });
    if (!link || !this.linkAccepts(link)) {
      return { joinable: false };
    }
    const list = await this.lists.findOne({ where: { id: link.generatedListId } });
    if (!list || !this.listAccepts(list)) {
      return { joinable: false };
    }
    return {
      joinable: true,
      name: list.name,
      participantCount: await this.participants.count({
        where: { generatedListId: list.id, revokedAt: IsNull() },
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
   * the partial unique index over (`generatedListId`, `userId`) makes a second
   * link they open resolve to the row they already have.
   */
  async join(
    req: JoinGeneratedListRequest
  ): Promise<GeneratedListJoinCoreResult> {
    const link = await this.links.findOne({ where: { secret: req.secret } });
    if (!link || !this.linkAccepts(link)) {
      // The same answer the preview gives, for the same reason: a revoked link
      // and one that never existed must not be distinguishable.
      throw new NotFoundException('This link is no longer accepting people');
    }
    const list = await this.lists.findOne({
      where: { id: link.generatedListId },
    });
    if (!list || !this.listAccepts(list)) {
      throw new NotFoundException('This link is no longer accepting people');
    }

    // The owner opening their own link is the owner, not a second identity.
    if (req.userId && req.userId === list.ownerUserId) {
      const owner = await this.ensureOwnerParticipant(list);
      return { generatedListId: list.id, participant: this.view(owner), sessionSecret: null };
    }

    if (req.userId) {
      const existing = await this.participants.findOne({
        where: { generatedListId: list.id, userId: req.userId },
      });
      if (existing) {
        if (existing.revokedAt) {
          // Rejoining a link you were thrown off is not a way back on. Section
          // 3.4's per participant revoke would mean nothing if it were.
          throw new UnauthorizedException('This link is no longer available to you');
        }
        existing.lastSeenAt = new Date();
        await this.participants.save(existing);
        return {
          generatedListId: list.id,
          participant: this.view(existing),
          sessionSecret: null,
        };
      }
    }

    const displayName = normalizeDisplayName(req.displayName);
    const sessionSecret = req.userId ? null : randomBytes(32).toString('base64url');

    const participant = await this.dataSource.transaction(async (manager) => {
      // Serializes concurrent joins on this basket, which is what lets the guest
      // number below be a `max + 1` rather than a sequence (see the SQL).
      await manager.query(`SELECT id FROM "generated_lists" WHERE id = $1 FOR UPDATE`, [
        list.id,
      ]);

      const total = await manager.count(GeneratedListParticipant, {
        where: { generatedListId: list.id, revokedAt: IsNull() },
      });
      if (total >= GENERATED_LIST_SHARING_LIMITS.maxParticipants) {
        throw new ConflictException('This basket already has as many people as it takes');
      }

      let guestNumber: number | null = null;
      if (!req.userId) {
        const [row] = await manager.query<{ next: string }[]>(
          NEXT_GUEST_NUMBER_SQL,
          [list.id]
        );
        guestNumber = Number(row?.next ?? 1);
      }

      return manager.save(
        manager.create(GeneratedListParticipant, {
          generatedListId: list.id,
          shareLinkId: link.id,
          kind: req.userId ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
          userId: req.userId ?? null,
          displayName,
          guestNumber,
          sessionSecretHash: sessionSecret ? hashSecret(sessionSecret) : null,
          userAgent: normalizeUserAgent(req.userAgent),
          joinedAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
        })
      );
    });

    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListParticipantJoined,
      list.id,
      this.view(participant)
    );
    return {
      generatedListId: list.id,
      participant: this.view(participant),
      sessionSecret,
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
   * `seesZoneData` is resolved here rather than by the caller because it is a
   * question about core's own access tables, and section 5.2 insists it is asked
   * **at request time** rather than read off the snapshot.
   */
  async resolveParticipant(
    req: ResolveParticipantRequest
  ): Promise<GeneratedListParticipantContext> {
    const participant = await this.findLiveParticipant(req);
    if (!participant) {
      throw new UnauthorizedException('Not a participant of this basket');
    }

    // Cheap and useful: presence and the share sheet both show it, and it costs
    // one write on a row already in the buffer pool.
    await this.participants.update(participant.id, { lastSeenAt: new Date() });

    return {
      participantId: participant.id,
      generatedListId: participant.generatedListId,
      kind: participant.kind,
      userId: participant.userId,
      seesZoneData: await this.seesZoneData(participant),
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
    generatedListId: string
  ): Promise<boolean> {
    const count = await this.participants.count({
      where: { id: participantId, generatedListId, revokedAt: IsNull() },
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
   */
  async livePresenceEntry(
    participantId: string,
    generatedListId: string
  ): Promise<ParticipantPresenceEntry | null> {
    const participant = await this.participants.findOne({
      where: { id: participantId, generatedListId, revokedAt: IsNull() },
    });
    if (!participant) {
      return null;
    }
    return {
      participantId: participant.id,
      kind: participant.kind,
      displayName: participant.displayName,
      guestNumber: participant.guestNumber,
      userId: participant.userId,
    };
  }

  /**
   * One live participant by id, on this basket (plan 0051, section 3.3).
   *
   * The row itself rather than {@link livePresenceEntry}'s projection, because
   * the callers that need it go on to ask {@link seesZoneData}, which is a
   * question about the participant's account and not about what is shown.
   *
   * The basket is part of the lookup rather than assumed from the id, on the same
   * reasoning as {@link isParticipantLive}: a participant of one basket must
   * never be admitted to another's by an id that happens to be valid somewhere.
   */
  async liveParticipantById(
    participantId: string,
    generatedListId: string
  ): Promise<GeneratedListParticipant | null> {
    return this.participants.findOne({
      where: { id: participantId, generatedListId, revokedAt: IsNull() },
    });
  }

  /** The participant behind a presented credential, or null. Live rows only. */
  async findLiveParticipant(
    req: ResolveParticipantRequest
  ): Promise<GeneratedListParticipant | null> {
    if (req.sessionSecret) {
      const participant = await this.participants.findOne({
        where: {
          sessionSecretHash: hashSecret(req.sessionSecret),
          revokedAt: IsNull(),
        },
      });
      // The secret identifies the row on its own, so the basket it names is
      // checked rather than trusted: a secret for another basket is not a
      // credential for this one.
      return participant && participant.generatedListId === req.generatedListId
        ? participant
        : null;
    }
    if (req.userId) {
      const participant = await this.participants.findOne({
        where: {
          generatedListId: req.generatedListId,
          userId: req.userId,
          revokedAt: IsNull(),
        },
      });
      if (participant) {
        return participant;
      }
      // An owner who has never been through a link still has a participant row,
      // lazily, which is what makes a basket generated before this plan
      // shareable rather than permanently unshareable.
      const list = await this.lists.findOne({
        where: { id: req.generatedListId, ownerUserId: req.userId },
      });
      return list ? await this.ensureOwnerParticipant(list) : null;
    }
    return null;
  }

  /**
   * Whether this participant may see zone data (plan 0051, section 5.2).
   *
   * True only for somebody holding `WRITE` on **every** list the run drew from,
   * evaluated now rather than at generation time. The owner passes by
   * construction (section 2), a `GUEST` never passes, having no account to hold
   * access with, and a `REGISTERED` participant passes only if they independently
   * have `WRITE` everywhere.
   *
   * The all or nothing shape has a known cliff: one source list where they hold
   * only `READ` collapses the whole view even when they have `WRITE` on the other
   * four. Section 11 keeps the per line alternative as the eventual target; it is
   * accepted here because it fails in the safe direction.
   */
  async seesZoneData(participant: GeneratedListParticipant): Promise<boolean> {
    if (participant.kind === ParticipantKind.OWNER) {
      return true;
    }
    if (!participant.userId) {
      return false;
    }
    const sources = await this.sourceListIds(participant.generatedListId);
    if (sources.length === 0) {
      // A basket with no origins draws on no zone at all, so there is no zone
      // data to withhold and nothing for the rule to protect.
      return true;
    }
    const writable = await this.writableAmong(participant.userId, sources);
    return sources.every((listId) => writable.has(listId));
  }

  /** Which of `listIds` this person may write, at request time (section 5.2). */
  async writableAmong(
    userId: string,
    listIds: readonly string[]
  ): Promise<Set<string>> {
    if (listIds.length === 0) {
      return new Set();
    }
    const rows = await this.lists.query<WritableAmongRow[]>(WRITABLE_AMONG_SQL, [
      userId,
      [...listIds],
    ]);
    return new Set(rows.map((row) => row.listId));
  }

  /** The distinct zone lists a basket's provenance rows point at. */
  async sourceListIds(generatedListId: string): Promise<string[]> {
    const rows = await this.lists.query<BasketSourceListRow[]>(
      BASKET_SOURCE_LISTS_SQL,
      [generatedListId]
    );
    return rows.map((row) => row.listId);
  }

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
  ): Promise<GeneratedListParticipantListResult> {
    const rows = await this.participants.find({
      where: { generatedListId: req.generatedListId, revokedAt: IsNull() },
      order: { joinedAt: 'ASC' },
    });

    let withDevices = true;
    if (req.asParticipantId) {
      const asker = rows.find((row) => row.id === req.asParticipantId);
      withDevices = asker ? await this.seesZoneData(asker) : false;
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
   * `GeneratedListService.create` means a basket generated before this plan
   * shipped is shareable too, instead of being permanently unshareable for want
   * of a row nobody can add.
   *
   * Idempotent by the same partial unique index that serves registered joiners,
   * so two concurrent first shares cannot mint two owner rows.
   */
  async ensureOwnerParticipant(
    list: GeneratedList
  ): Promise<GeneratedListParticipant> {
    const existing = await this.participants.findOne({
      where: { generatedListId: list.id, userId: list.ownerUserId },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.participants.save(
        this.participants.create({
          generatedListId: list.id,
          shareLinkId: null,
          kind: ParticipantKind.OWNER,
          userId: list.ownerUserId,
          displayName: null,
          guestNumber: null,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt: list.generatedAt ?? new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
        })
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.participants.findOne({
          where: { generatedListId: list.id, userId: list.ownerUserId },
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
    generatedListId: string
  ): Promise<GeneratedList> {
    const list = await this.lists.findOne({
      where: { id: generatedListId, ownerUserId: userId },
    });
    if (!list) {
      throw new NotFoundException('Generated list not found');
    }
    return list;
  }

  private liveLink(
    generatedListId: string
  ): Promise<GeneratedListShareLink | null> {
    return this.links.findOne({
      where: { generatedListId, revokedAt: IsNull() },
    });
  }

  /** Whether a link may still mint participants. Revocation and expiry only. */
  private linkAccepts(link: GeneratedListShareLink): boolean {
    if (link.revokedAt) {
      return false;
    }
    return !link.expiresAt || link.expiresAt.getTime() > Date.now();
  }

  /**
   * Whether a basket may still take people (plan 0051, section 11's leaning).
   *
   * A completed or archived basket stops accepting them, because an
   * unauthenticated read of somebody's shopping habits should not outlive the
   * trip. It does **not** evict the people already on it, on exactly the reasoning
   * section 3.4 applies to a revoked link.
   */
  private listAccepts(list: GeneratedList): boolean {
    return (
      list.status === GeneratedListStatus.DRAFT ||
      list.status === GeneratedListStatus.ACTIVE
    );
  }

  private resolveExpiry(requested: string | null | undefined): Date | null {
    const cap = new Date(
      Date.now() +
        GENERATED_LIST_SHARING_LIMITS.defaultLinkTtlDays * 24 * 60 * 60 * 1000
    );
    if (requested === undefined || requested === null) {
      return cap;
    }
    const asked = new Date(requested);
    if (Number.isNaN(asked.getTime())) {
      throw new ValidationException('expiresAt is not a date', {
        messageArgs: { field: 'expiresAt' },
      });
    }
    // The cap is a cap, not a default to be argued out of: a caller may ask for
    // less than it and never for more.
    return asked.getTime() < cap.getTime() ? asked : cap;
  }

  private async linkView(
    link: GeneratedListShareLink
  ): Promise<GeneratedListShareLinkView> {
    const participantCount = await this.participants.count({
      where: { shareLinkId: link.id, revokedAt: IsNull() },
    });
    return toShareLinkView(link, participantCount);
  }

  private view(participant: GeneratedListParticipant): GeneratedListParticipantView {
    return toParticipantView(participant, false);
  }

  private announceLeft(
    generatedListId: string,
    participant: GeneratedListParticipant
  ): void {
    this.events.emitToGeneratedList(
      RealtimeEvent.GeneratedListParticipantLeft,
      generatedListId,
      this.view(participant)
    );
  }
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
  return trimmed.slice(0, GENERATED_LIST_SHARING_LIMITS.displayNameMaxLength);
}

/** Capped to the column width; a header is attacker controlled and unbounded. */
function normalizeUserAgent(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 400) : null;
}
