import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  COMMENT_SERVICE,
  LineStore,
  MemberNames,
  SessionStore,
  type CommentServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type Comment,
  type CommentRowVm,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { CommentComposer, CommentRow, SheetShell } from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';

/**
 * How far from the bottom still counts as being at the newest comment.
 *
 * Roughly a line of text: sub pixel scroll positions and a part scrolled row both leave
 * a gap of a few pixels at what any reader would call the bottom.
 */
const AT_NEWEST_SLACK_PX = 32;

/**
 * What people have said about one line.
 *
 * ## The one place a reader can act
 *
 * `comment.add` requires only an approved membership on the zone, not write access on
 * the list. That is the backend's choice rather than this client's, and it is the
 * reason the comment affordance stays on every row even in the read only state: it is
 * the single thing somebody with read access can actually do (section 3.2).
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
})
export class CommentsSheet {
  private readonly _comments = inject<CommentServiceI>(COMMENT_SERVICE);
  private readonly _lines = inject(LineStore);
  private readonly _names = inject(MemberNames);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
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

    return this._raw()
      .map((comment) => ({
        id: comment.id,
        author: this._names.nameOf(zoneId, comment.authorUserId),
        body: comment.body,
        createdAt: comment.createdAt,
        mine: comment.authorUserId === me,
      }))
      .reverse();
  });

  readonly empty = computed(
    () => !this.loading() && this.comments().length === 0
  );

  private readonly _scroller =
    viewChild<ElementRef<HTMLElement>>('conversation');

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
      const list = this._scroller()?.nativeElement;

      // Read so the effect re-runs when somebody says something, here or on the socket.
      const said = this.comments().length;

      if (list === undefined || said === 0 || !this._atNewest) {
        return;
      }

      list.scrollTop = list.scrollHeight;
    });
  }

  /**
   * Follow the scrollbar, so a reader who has gone up to read an older comment is not
   * dragged back down the moment the next one lands.
   */
  trackPosition(list: HTMLElement): void {
    const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    this._atNewest = fromBottom <= AT_NEWEST_SLACK_PX;
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
    await this._router.navigateByUrl(
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
