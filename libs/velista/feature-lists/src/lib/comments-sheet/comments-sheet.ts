import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  COMMENT_SERVICE,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
  type CommentServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  VOICE_COMMENT_MAX_SECONDS,
  VOICE_COMMENT_WARN_SECONDS,
  type Comment,
  type CommentRowVm,
  type RecordedAudio,
} from '@portfolio/velista/models';
import {
  appPath,
  AudioRecorder,
  lineIdOf,
  listIdOf,
  RECORDING_LIMITS,
  SheetNavigation,
  zoneIdOf,
  type RecordingLimits,
} from '@portfolio/velista/platform';
import { CommentComposer, CommentRow, SheetShell } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';
import { selectAbilities } from '../select-list-state';

/**
 * How far from the bottom still counts as being at the newest comment.
 *
 * Roughly a line of text: sub pixel scroll positions and a part scrolled row both leave
 * a gap of a few pixels at what any reader would call the bottom.
 */
const AT_NEWEST_SLACK_PX = 32;

/**
 * The bubble that stands in for a voice comment while it uploads (plan 0039,
 * section 5).
 *
 * A constant rather than something built per send, because there is nothing about
 * it that varies: it says a recording is being sent and **never shows a guess at
 * the words**. The client has nothing to guess from, and a bubble with invented
 * text is worse than one that says it is waiting.
 *
 * Its id cannot collide with a real comment's, which is a uuid from the server.
 */
const PENDING_ROW: CommentRowVm = {
  id: 'pending-voice-comment',
  author: null,
  body: '',
  recording: null,
  transcription: null,
  pending: true,
  createdAt: new Date(0),
  mine: true,
};

/**
 * What people have said about one line.
 *
 * ## A reader may read it and may not write in it
 *
 * `comment.add` used to require only an approved membership on the zone, which made this
 * the one thing a reader could really do. Backend plan 0036 section 4 narrows it to
 * `WRITE` or `DECIDE`, so read now means read here as well, and this is the visible
 * removal plan 0030 section 3.1 flags: somebody with `READER` on a list today can
 * comment on it and will not be able to afterwards.
 *
 * The sheet still **opens** for everybody who holds `READ`, and the row's overflow still
 * carries the entry that opens it, because reading what the group said about a line is
 * part of seeing the list. What goes is the composer, and its position is taken by a
 * line saying why. `0027` has just pinned that composer under the conversation, which
 * makes it the most prominent thing on the sheet and always in view, and that is
 * precisely the control that must not be drawn for somebody who cannot use it. Putting
 * the note **where it was** rather than simply dropping it also stops the sheet ending
 * in nothing, which reads like a conversation that failed to load.
 *
 * ## Names come from the zone, not from the comment
 *
 * `CommentView` carries `authorUserId` and no username, and the only place in the whole
 * API that pairs an id with a name is a membership. `MemberNames` holds that map, per
 * zone, and a comment whose author has left the group falls back to a neutral phrase
 * rather than to an id and never to the word Unknown (section 5.4).
 *
 * ## It talks to the service directly, and to the store as well
 *
 * The comments themselves are sheet state: there is one line's worth of them, they are
 * read here and nowhere else, and a store for them would be a cache nothing else reads.
 * The **count**, though, goes to `LineStore`, because the row underneath draws it and
 * this is the only moment the client ever learns it: nothing on the wire carries a
 * comment count.
 *
 * ## It reads like a chat, which the wire order does not
 *
 * The endpoint answers newest first and `LineStore` keeps that order, because it is the
 * order the next page continues from. A conversation is read the other way round:
 * oldest at the top, the newest thing said at the bottom, and the view opens there
 * rather than at the beginning. So `comments` reverses, and the scroller is put at the
 * bottom by hand, since a scroll box starts at the top and nothing in the markup asks
 * it to start anywhere else.
 */
@Component({
  selector: 'lib-comments-sheet',
  imports: [RokuTranslatorPipe, CommentComposer, CommentRow, SheetShell],
  templateUrl: './comments-sheet.html',
  styleUrl: './comments-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The composer's recorder, with the comment cap on it (plan 0041, section 6.2).
  //
  // Here rather than in `root` for the reason `AudioRecorder`'s own doc gives:
  // destroying it releases the microphone, so closing this sheet mid recording
  // cannot leave the browser's indicator on behind a component nobody holds. It
  // also keeps a recording started in a comment from colliding with one open in
  // the assistant panel, since each has its own instance.
  //
  // A minute, where the assistant runs to five. `VOICE_COMMENT_MAX_SECONDS` stays
  // the single source of the number; what changes is that the composer now reads
  // it through the token instead of importing the constant, which is what makes
  // both interesting states reachable in a spec without waiting.
  providers: [
    AudioRecorder,
    {
      provide: RECORDING_LIMITS,
      useValue: {
        warnAtSeconds: VOICE_COMMENT_WARN_SECONDS,
        maxSeconds: VOICE_COMMENT_MAX_SECONDS,
      } satisfies RecordingLimits,
    },
  ],
})
export class CommentsSheet {
  private readonly _comments = inject<CommentServiceI>(COMMENT_SERVICE);
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _names = inject(MemberNames);
  private readonly _session = inject(SessionStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly errorKey = signal<string | null>(null);

  /**
   * Whether a voice comment is on its way up (plan 0039, section 5).
   *
   * A voice send takes seconds: an upload over mobile data, then a transcription
   * at the provider. A composer sitting disabled for four seconds with no bubble
   * on screen reads as a failure, and people press again. So a bubble appears the
   * moment sending starts and is replaced by the real comment when the response
   * lands, or removed when it fails.
   *
   * **The typed path is untouched.** One fast request with nothing racing it does
   * not need a bubble that can be wrong.
   */
  private readonly _sendingVoice = signal(false);

  /**
   * The conversation, from `LineStore` (plan 0018, gap 2).
   *
   * It was a signal here, and that was the bug: the sheet appended the comment the
   * reader posted, `comment.added` from anybody else went to the line's count and
   * nowhere near this list, and two people talking on one line is the ordinary case
   * for this product. The rows live beside the count and the event now.
   */
  private readonly _raw = computed<readonly Comment[]>(
    () => this._lines.commentsOf(this.lineId()) ?? []
  );

  /** What the sheet is titled: the line it is about, by name. */
  readonly lineName = computed(
    () =>
      this._lines
        .linesIn(this.listId())
        .find((line) => line.id === this.lineId())?.content ?? ''
  );

  /** Oldest first, so the conversation reads downwards and ends at the newest line. */
  readonly comments = computed<readonly CommentRowVm[]>(() => {
    const zoneId = this.zoneId();
    const me = this._session.userId();

    const rows = this._raw()
      .map((comment) => ({
        id: comment.id,
        author: this._names.nameOf(zoneId, comment.authorUserId),
        body: comment.body,
        // The row draws the player from this, and the player fetches only when
        // play is pressed: the source is an id to ask for, never a URL that has
        // already been downloaded (plan 0039, section 4).
        recording:
          comment.recording === null
            ? null
            : {
                src: comment.id,
                durationSeconds: comment.recording.durationSeconds,
              },
        transcription: comment.transcription,
        pending: false,
        createdAt: comment.createdAt,
        mine: comment.authorUserId === me,
      }))
      .reverse();

    // At the bottom, which is where the newest thing said always is, and in the
    // caller's own position because it is theirs.
    return this._sendingVoice() ? [...rows, PENDING_ROW] : rows;
  });

  readonly empty = computed(
    () => !this.loading() && this.comments().length === 0
  );

  /**
   * Whether this caller may say anything, from the same four tests the page uses.
   *
   * Read from `ListStore` rather than handed down, because this is a routed child and is
   * reachable by a deep link on a list whose page never drew. An unloaded list answers
   * the empty set and therefore no composer, which is the safe direction: a composer that
   * appears once the list lands is a sheet filling in, and one that vanishes after
   * somebody has typed into it is a sheet losing their sentence.
   */
  readonly canComment = computed(() => {
    const list = this._lists
      .listsIn(this.zoneId())
      .find((candidate) => candidate.id === this.listId());

    return selectAbilities(list?.myPermissions ?? []).canComment;
  });

  /**
   * The shell, for the element that scrolls (plan 0040, section 3).
   *
   * The conversation used to scroll inside its own 40vh box and this measured that box.
   * The sheet is one scroll now and it belongs to `SheetShell`, so both the reading and
   * the writing below go through the shell's body. Getting this wrong fails silently:
   * bound to an element that no longer scrolls, {@link trackPosition} never fires,
   * `_atNewest` stays true forever, and a reader who has gone up to read something older
   * is yanked back down every time somebody says something.
   */
  private readonly _shell = viewChild.required(SheetShell);

  /**
   * The composer, so a send can tell it what happened.
   *
   * Reached by view child rather than driven by an input, because what the sheet
   * needs to say is "that worked, let go of it" and "that failed, hold on to it",
   * and both are events rather than state: an input would make the held recording
   * the sheet's to own, and it is the composer's precisely so a failed send cannot
   * lose it.
   */
  private readonly _composer = viewChild(CommentComposer);

  /**
   * Whether the reader is sitting at the newest comment.
   *
   * A plain field and not a signal on purpose: the render effect below reads it, and a
   * signal would make every scroll event re-run that effect and take the scrollbar back
   * off somebody who was reading further up.
   */
  private _atNewest = true;

  constructor() {
    void this._names.ensure(this.zoneId());
    void this._load();

    // The conversation opens at its end, and stays there while new comments arrive,
    // unless the reader has scrolled up to read something older. `afterRenderEffect`
    // rather than `effect`, because the rows have to exist before they can be measured,
    // and it runs in the browser and never on the server (plan 0001, D2).
    afterRenderEffect(() => {
      const body = this._shell().body().nativeElement;

      // Read so the effect re-runs when somebody says something, here or on the socket.
      const said = this.comments().length;

      if (said === 0 || !this._atNewest) {
        return;
      }

      body.scrollTop = body.scrollHeight;
    });
  }

  /**
   * Follow the scrollbar, so a reader who has gone up to read an older comment is not
   * dragged back down the moment the next one lands.
   */
  trackPosition(): void {
    const body = this._shell().body().nativeElement;
    const fromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    this._atNewest = fromBottom <= AT_NEWEST_SLACK_PX;
  }

  /**
   * Fetch one comment's recording, for the player in its row.
   *
   * The sheet supplies this rather than the row reaching for a service, because a
   * `ui` component may not know about the API (rule D1). The URL it answers is an
   * object URL the player owns and revokes.
   */
  readonly loadAudio = (commentId: string): Promise<string> =>
    this._comments.commentAudioUrl(commentId);

  /**
   * Send a recording (plan 0039, section 5).
   *
   * **A failed send never discards the recording.** Nothing here touches what the
   * composer is holding: on success it is told to clear, and on failure it is told
   * what went wrong and keeps the blob, so the send button can be pressed again.
   * Somebody just spoke for forty seconds, and losing that to a dropped connection
   * is the worst outcome in this plan.
   */
  async sendVoice(recording: RecordedAudio): Promise<void> {
    this.sending.set(true);
    this._sendingVoice.set(true);
    this.errorKey.set(null);

    try {
      const comment = await this._comments.addVoiceComment(
        this.lineId(),
        recording.blob,
        recording.durationSeconds
      );
      // The same upsert the typed path makes, and for the same reason: this
      // comment arrives twice, once here and once on the socket. It arrives a
      // third time later as `comment.updated`, carrying the transcript, and that
      // upserts over this one.
      this._lines.addComment(comment);
      this._composer()?.clear();
    } catch (error) {
      const key = listErrorKey(error, 'comments');
      this.errorKey.set(key);
      // `listErrorKey` answers null for the one failure that is meant to be
      // silent, and the composer still has to be told the send failed so it holds
      // on to the recording. The generic line stands in for that case.
      this._composer()?.reportError(key ?? 'list.error.failed');
    } finally {
      this._sendingVoice.set(false);
      this.sending.set(false);
    }
  }

  async send(body: string): Promise<void> {
    this.sending.set(true);
    this.errorKey.set(null);

    try {
      const comment = await this._comments.addComment(this.lineId(), body);
      // The same call `comment.added` makes, and an upsert rather than an append for
      // that reason: this comment arrives twice, once here and once on the socket.
      // Prepended by the store, which holds the wire's newest first order; the sheet
      // reverses it, so this lands at the bottom of the screen. Optimism is not needed:
      // a comment has no state to reconcile and the round trip is one request with
      // nothing racing it.
      this._lines.addComment(comment);
    } catch (error) {
      this.errorKey.set(listErrorKey(error, 'comments'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }

  private async _load(): Promise<void> {
    try {
      const page = await this._comments.listComments(this.lineId(), {
        limit: 50,
      });
      // Rows and count together, since a loaded page is the only honest source of
      // either and setting one without the other lets a row claim a number its own
      // list disagrees with.
      this._lines.recordComments(this.lineId(), page.items);
    } catch (error) {
      this.errorKey.set(listErrorKey(error, 'comments'));
    } finally {
      this.loading.set(false);
    }
  }
}
