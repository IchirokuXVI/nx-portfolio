import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  baseContentType,
  CommentTranscription,
  ListPermission,
  RealtimeEvent,
  type AddCommentRequest,
  type AddVoiceCommentRequest,
  type CommentAudioView,
  type CommentPage,
  type CommentView,
  type GetCommentAudioRequest,
  type ListCommentsRequest,
  type SetCommentTranscriptionRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  ForbiddenException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { DataSource, Repository } from 'typeorm';
import type { CoreConfig } from '../config/app-config';
import { CommentAudio, LineComment } from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ListAccessService } from './list-access.service';
import { toCommentView } from './list.mappers';

interface CommentCursor {
  value: string;
  id: string;
}

@Injectable()
export class CommentService {
  private readonly voice: CoreConfig['voiceComment'];

  constructor(
    @InjectRepository(LineComment)
    private readonly comments: Repository<LineComment>,
    @InjectRepository(CommentAudio)
    private readonly audio: Repository<CommentAudio>,
    private readonly dataSource: DataSource,
    private readonly listAccess: ListAccessService,
    private readonly events: CoreEventsPublisher,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.voice = configService.getOrThrow<CoreConfig>('core').voiceComment;
  }

  /**
   * Add a comment (plan 0007, section 2; plan 0036, section 4). `WRITE` or
   * `DECIDE`.
   *
   * It used to ask only for an approved zone membership, which was wrong at both
   * ends (plan 0036, section 1.4): a caller with no access to the list at all
   * could comment on its lines, and a caller who could see the list and nothing
   * else could too. Read should mean read, comments included, and commenting
   * should follow access to the list.
   *
   * Either of the two, because both describe somebody who takes part: the person
   * who puts things on the list and the person who decides what goes in the
   * trolley both have things to say about a line. `MANAGE` implies both in every
   * grant this service writes, so it needs no third branch.
   */
  async add(req: AddCommentRequest): Promise<CommentView> {
    const line = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      line.listId,
      req.userId
    );
    if (
      !permissions.has(ListPermission.WRITE) &&
      !permissions.has(ListPermission.DECIDE)
    ) {
      throw new ForbiddenException(
        'You can read this list but not write to it, comments included'
      );
    }

    const saved = await this.comments.save(
      this.comments.create({
        lineId: req.lineId,
        authorUserId: req.userId,
        body: req.body,
        // Stated rather than left to the entity's defaults, because these four
        // are what tell a client this is a typed comment with nothing to play and
        // no transcript coming (plan 0045, section 8).
        audioContentType: null,
        audioByteLength: null,
        audioDurationSeconds: null,
        transcription: null,
      })
    );
    const view = toCommentView(saved);
    this.events.emit(RealtimeEvent.CommentAdded, list.zoneId, view, list.id);
    return view;
  }

  /**
   * Leave a comment that is a recording (plan 0045, section 4).
   *
   * The same permission as a typed comment, deliberately: `WRITE` or `DECIDE`,
   * with no separate voice permission, because adding one would invent a
   * distinction the product does not make.
   *
   * **The comment and its bytes are written in one transaction, and nothing is
   * transcribed first.** That order is the plan's central decision. A
   * transcription is a *reading* of the message, so if the provider is rate
   * limited, or down, or the deployment has no key at all, the message must still
   * exist and still play; transcribing first would mean a provider outage
   * silently swallows what somebody said. The comment comes back with a recording
   * and no body yet, and the gateway asks for the transcript afterwards.
   *
   * The response therefore leaves here in {@link CommentTranscription.PENDING},
   * always, even on a deployment with no provider. Core cannot know whether one
   * is configured, because rule A1 keeps that credential in the assistant, and
   * the gateway settles the state to `UNAVAILABLE` within the same second when
   * there is nothing to ask.
   */
  async addVoice(req: AddVoiceCommentRequest): Promise<CommentView> {
    const line = await this.listAccess.getLine(req.lineId);
    const { list, permissions } = await this.listAccess.resolve(
      line.listId,
      req.userId
    );
    if (
      !permissions.has(ListPermission.WRITE) &&
      !permissions.has(ListPermission.DECIDE)
    ) {
      throw new ForbiddenException(
        'You can read this list but not write to it, comments included'
      );
    }

    const contentType = baseContentType(req.contentType);
    if (!this.voice.contentTypes.includes(contentType)) {
      throw new ValidationException(
        `That recording is in a format this server cannot read (${contentType}). ` +
          `Accepted: ${this.voice.contentTypes.join(', ')}`
      );
    }

    const bytes = Buffer.from(req.audio, 'base64');
    if (bytes.byteLength === 0) {
      throw new ValidationException('That recording arrived empty');
    }
    // The second of the two enforcements plan 0041 section 5 asks for. The first
    // is the gateway's interceptor, which is what stops a large upload being
    // buffered at all; this one is what stops a payload that reached the broker
    // by some other route being written to the database.
    if (bytes.byteLength > this.voice.maxBytes) {
      throw new ValidationException(
        `That recording is ${describeBytes(bytes.byteLength)}, ` +
          `and the limit is ${describeBytes(this.voice.maxBytes)}`
      );
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const comment = await manager.save(
        manager.create(LineComment, {
          lineId: req.lineId,
          authorUserId: req.userId,
          // No body, and no guess at one. The client has nothing to guess from
          // either, and a bubble showing invented text is worse than one showing
          // that it is waiting (plan 0041, section 8.4).
          body: '',
          audioContentType: contentType,
          audioByteLength: bytes.byteLength,
          // Recorded from the client and never trusted (section 6): metadata for
          // drawing a row before the file is fetched, and nothing else.
          audioDurationSeconds: normalizeDuration(req.durationSeconds),
          transcription: CommentTranscription.PENDING,
        })
      );

      await manager.save(
        manager.create(CommentAudio, {
          commentId: comment.id,
          contentType,
          audio: bytes,
        })
      );

      return comment;
    });

    const view = toCommentView(saved);
    this.events.emit(RealtimeEvent.CommentAdded, list.zoneId, view, list.id);
    return view;
  }

  /**
   * The bytes (plan 0045, section 5).
   *
   * Gated on `READ` of the comment's list, which is the same gate as reading the
   * comment's text and deliberately not a separate permission: plan 0036 section
   * 4.3 says `READ` is genuinely everything else about a list's content, and a
   * recording somebody left on a line is that.
   *
   * This is the **only** thing in this service that selects the audio table, and
   * that is the property section 2 rests on. Everything a listing draws comes from
   * the comment's own columns.
   */
  async getAudio(req: GetCommentAudioRequest): Promise<CommentAudioView> {
    const comment = await this.comments.findOne({
      where: { id: req.commentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const line = await this.listAccess.getLine(comment.lineId);
    await this.listAccess.requireRead(line.listId, req.userId);

    const row = await this.audio.findOne({
      where: { commentId: req.commentId },
    });
    if (!row) {
      // A typed comment, or a voice comment whose row is gone. Not found rather
      // than an empty body: there is no recording to play, and saying so is the
      // honest answer.
      throw new NotFoundException('That comment has no recording');
    }

    return {
      commentId: row.commentId,
      contentType: row.contentType,
      audio: row.audio.toString('base64'),
    };
  }

  /**
   * Fill in a voice comment's transcript, or record that it has none (plan 0045,
   * section 4).
   *
   * Two properties are load bearing.
   *
   * **It only ever moves a comment out of `PENDING`.** A call against a settled
   * comment changes nothing and answers the comment as it stands, which is what
   * makes the gateway's bounded retry safe to run: a retry arriving after a first
   * attempt already landed cannot overwrite the words with a second reading of
   * the same audio.
   *
   * **It checks the author.** The gateway is the only caller and it is inside the
   * cluster, but the check costs one comparison and means no path exists that
   * writes words into somebody else's message. It does not check list
   * permissions, because the permission was checked when the comment was created,
   * and the author's access changing in the two seconds since is not a reason to
   * lose their transcript.
   */
  async setTranscription(
    req: SetCommentTranscriptionRequest
  ): Promise<CommentView> {
    const comment = await this.comments.findOne({
      where: { id: req.commentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorUserId !== req.userId) {
      throw new ForbiddenException('That is not your comment');
    }

    if (comment.transcription !== CommentTranscription.PENDING) {
      return toCommentView(comment);
    }

    comment.transcription = req.transcription;
    // Only `READY` carries words. Every other state leaves the body empty, which
    // is a valid comment and the state the client draws a neutral phrase for.
    comment.body =
      req.transcription === CommentTranscription.READY ? req.body.trim() : '';
    // A transcript that came back as whitespace produced nothing, and calling
    // that READY would leave the client drawing an empty bubble rather than the
    // phrase it has for exactly this.
    if (
      comment.transcription === CommentTranscription.READY &&
      comment.body === ''
    ) {
      comment.transcription = CommentTranscription.FAILED;
    }

    const saved = await this.comments.save(comment);
    const view = toCommentView(saved);

    const line = await this.listAccess.getLine(saved.lineId);
    const list = await this.listAccess.getList(line.listId);
    this.events.emit(RealtimeEvent.CommentUpdated, list.zoneId, view, list.id);

    return view;
  }

  /**
   * List a line's comments (plan 0007, section 3). `READ`, which is genuinely
   * everything on a list a caller may see. Fixed newest-to-oldest order (no
   * caller-chosen ordering), cursor paginated.
   *
   * **This query never touches `comment_audio`**, and that is the property plan
   * 0045 section 2 rests on rather than an accident of how it is written today.
   * The recording's metadata lives on the comment, so a page of fifteen voice
   * comments costs exactly what a page of fifteen typed ones costs, and the bytes
   * are reached only by the playback route. `select` is stated explicitly so that
   * adding a column to the entity cannot quietly widen this.
   */
  async list(req: ListCommentsRequest): Promise<CommentPage> {
    const line = await this.listAccess.getLine(req.lineId);
    await this.listAccess.requireRead(line.listId, req.userId);

    const limit = clampPageSize(req.limit);
    const cursor = decodeCursor(req.cursor) as CommentCursor | undefined;

    const qb = this.comments
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.lineId',
        'c.authorUserId',
        'c.body',
        'c.audioContentType',
        'c.audioByteLength',
        'c.audioDurationSeconds',
        'c.transcription',
        'c.createdAt',
      ])
      .where('c."lineId" = :lineId', { lineId: req.lineId })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere('(c."createdAt", c.id) < (:cv, :cid)', {
        cv: cursor.value,
        cid: cursor.id,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toCommentView);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id })
        : null;

    return { items, nextCursor };
  }
}

/**
 * A byte count as somebody would say it, for a message that has to name the
 * limit (plan 0041, section 5).
 *
 * Whole megabytes to one decimal, because "2097152 bytes" is a number nobody can
 * compare against the recording they just made.
 */
function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/**
 * The client's claimed duration, or null.
 *
 * Anything that is not a finite positive number becomes null rather than an
 * error: this value authorizes nothing and rejects nothing, so refusing a whole
 * recording over a malformed hint about its length would be the wrong trade.
 */
function normalizeDuration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}
