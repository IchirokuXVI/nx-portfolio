import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  APP_STANDALONE_ORIGIN,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { ShareIcon, SheetShell } from '@portfolio/velista/ui';
import { basketPath, basketShareUrl } from '../basket-paths';

/** Which half of the sheet is showing: the link, or the question about revoking. */
type Pane = 'link' | 'revoke';

/**
 * The one link, and taking it back (plan 0044, section 5.2).
 *
 * ## Zero links or one
 *
 * A basket starts with zero. Opening this sheet **mints** one if there is none,
 * which is what pressing share means; revoking returns it to zero, and sharing
 * again mints a fresh one. The one link can be copied again at any time, from any
 * of the owner's devices, because handing it to the next person tomorrow must not
 * depend on a string copied once (backend `0051`, section 3.1).
 *
 * That is why the route is `PUT` and not `POST`: pressing share on two devices
 * produces one link, not two.
 *
 * ## Revoking asks a real question, and the default is the kind one
 *
 * **Revoking a link does not evict the people already shopping.** They keep
 * working and the same URL still opens the list for them, because their session
 * is what authorizes them and the link was only an invitation they already
 * accepted. That is the common intent, and a screen that silently kicked three
 * people out of a shop would be the worst possible reading of a one word button.
 *
 * So the cascade is a **separate, explicit tick** with its own sentence, defaulted
 * off, and the confirm button says what it does rather than saying "OK".
 *
 * ## The copied URL carries no locale
 *
 * `shareUrl` builds `{origin}{mount}/s/{secret}` and stops there. The recipient's
 * language is not knowable here, and `localeGuard` inserts theirs on arrival, so
 * baking the sender's in would open the app in the wrong language for exactly the
 * person it was sent to.
 *
 * ## Two ways to hand it over, and the second one is a phone's
 *
 * Copy is always there, because a URL on the clipboard goes anywhere. The share
 * control beside it opens the operating system's own sheet, which is how a link
 * actually reaches a group chat on the device this screen is used on, and it is
 * drawn only where `navigator.share` exists: a button that opens nothing is worse
 * than one that is absent. That is the treatment the invite card already gives the
 * group's link, and this is the same act on the other kind of link.
 */
@Component({
  selector: 'lib-share-sheet',
  imports: [RokuTranslatorPipe, ShareIcon, SheetShell],
  templateUrl: './share-sheet.html',
  styleUrl: './share-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _standaloneOrigin = inject(APP_STANDALONE_ORIGIN);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  private readonly _pane = signal<Pane>('link');
  private readonly _busy = signal(false);
  private readonly _copied = signal(false);

  protected readonly pane = this._pane.asReadonly();
  protected readonly busy = this._busy.asReadonly();
  protected readonly copied = this._copied.asReadonly();
  protected readonly link = this._store.shareLink;

  /** Whether the cascade is ticked. Off by default, and it stays a second choice. */
  protected readonly cascade = signal(false);

  /**
   * Whether to offer the operating system's share sheet at all.
   *
   * The Web Share API is a phone's and mostly is not a desktop's. Read through
   * `BrowserFacade` (rule D2) rather than off `navigator`, and read once: it is a
   * fact about the browser and does not change while this sheet is open.
   */
  protected readonly canShare =
    this._browser.window?.navigator.share !== undefined;

  /** How many people arrived through this link, for both panes' sentences. */
  protected readonly joinedCount = computed(
    () => this.link()?.participantCount ?? 0
  );

  /**
   * The URL to hand somebody.
   *
   * Built from the standalone origin rather than from wherever this tab happens
   * to be: velista is reachable at `ichirokuxvi.com/velista` and at
   * `velista.app`, and the link that goes into a group chat should be the app's
   * own address rather than the portfolio's.
   */
  protected readonly url = computed(() => {
    const secret = this.link()?.secret;
    return secret === undefined
      ? ''
      : basketShareUrl(
          this._standaloneOrigin || this._browser.window?.location.origin || '',
          this._basePath,
          secret
        );
  });

  constructor() {
    // Pressing share is what gives a basket a link at all, so the sheet opening
    // is the gesture: it ensures rather than reads, and a basket that already has
    // one gets that one back.
    void this._ensure();
  }

  private async _ensure(): Promise<void> {
    this._busy.set(true);
    await this._store.share();
    this._busy.set(false);
  }

  protected async copy(): Promise<void> {
    const url = this.url();
    if (url === '') {
      return;
    }
    await this._browser.window?.navigator.clipboard?.writeText(url);
    this._copied.set(true);
  }

  /**
   * Hand the link to the operating system's share sheet.
   *
   * Falls back to copying when the API is missing, which is what makes the control
   * safe to offer at all, and swallows a rejection: dismissing the system sheet
   * rejects, and a dismissal is not a failure worth a sentence. Nothing is claimed
   * either way, because this screen cannot know where the link went.
   *
   * The URL alone, as the invite card's share already does: the system sheet reads
   * the page it is handed, and a title written here would be this app's words
   * appearing inside somebody else's message.
   */
  protected async share(): Promise<void> {
    const url = this.url();
    if (url === '') {
      return;
    }

    const navigator = this._browser.window?.navigator;
    if (navigator?.share === undefined) {
      await this.copy();
      return;
    }

    try {
      await navigator.share({ url });
    } catch {
      // Dismissed, or refused. The link is still on screen and still copyable.
    }
  }

  protected askRevoke(): void {
    this.cascade.set(false);
    this._pane.set('revoke');
  }

  protected async revoke(): Promise<void> {
    this._busy.set(true);
    await this._store.revokeLink(this.cascade());
    this._busy.set(false);
    this.close();
  }

  protected keepIt(): void {
    this._pane.set('link');
  }

  /**
   * Cancel, Escape, the scrim, the back button, and a revoke that went through.
   *
   * The basket's whole URL, through `SheetNavigation`, like every other sheet in
   * the app: a relative `..` climbs one segment of whatever path the sheet
   * happens to sit on, which is a fact about the route table that changes without
   * this file being touched, and an ordinary `navigate` pushes, leaving the sheet
   * one back press from reopening (plan 0031).
   */
  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._generatedListId())
    );
  }
}
