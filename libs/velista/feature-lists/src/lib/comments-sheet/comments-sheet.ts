import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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
import {
  CommentComposer,
  CommentRow,
  SheetShell,
} from '@portfolio/velista/ui';
import { listErrorKey } from '../list-error-copy';

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

  private readonly _raw = signal<readonly Comment[]>([]);

  /** What the sheet is titled: the line it is about, by name. */
  readonly lineName = computed(
    () =>
      this._lines
        .linesIn(this.listId())
        .find((line) => line.id === this.lineId())?.content ?? ''
  );

  readonly comments = computed<readonly CommentRowVm[]>(() => {
    const zoneId = this.zoneId();
    const me = this._session.userId();

    return this._raw().map((comment) => ({
      id: comment.id,
      author: this._names.nameOf(zoneId, comment.authorUserId),
      body: comment.body,
      createdAt: comment.createdAt,
      mine: comment.authorUserId === me,
    }));
  });

  readonly empty = computed(
    () => !this.loading() && this.comments().length === 0
  );

  constructor() {
    void this._names.ensure(this.zoneId());
    void this._load();
  }

  async send(body: string): Promise<void> {
    this.sending.set(true);
    this.errorKey.set(null);

    try {
      const comment = await this._comments.addComment(this.lineId(), body);
      // Prepended, because the endpoint answers newest first and the sheet draws that
      // order. Optimism is not needed here: a comment has no state to reconcile and
      // the round trip is one request with nothing racing it.
      this._raw.update((current) => [comment, ...current]);
      this._recordCount();
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
      this._raw.set(page.items);
      this._recordCount();
    } catch (error) {
      this.errorKey.set(listErrorKey(error, 'comments'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Tell the store what the row should show.
   *
   * The only honest source of a comment count there is: `LineView` has no such field
   * and neither does anything else on the wire, so the row shows a number exactly when
   * somebody has opened this sheet and nothing at all otherwise. A count from a paged
   * response is the count of what was fetched, so it is recorded only when the whole
   * conversation arrived.
   */
  private _recordCount(): void {
    this._lines.recordCommentCount(this.lineId(), this._raw().length);
  }
}
