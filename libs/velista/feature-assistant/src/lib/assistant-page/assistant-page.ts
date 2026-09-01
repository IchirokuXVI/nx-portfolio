import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  APP_BASE_PATH,
  ASSISTANT_AUDIO_MAX_MB,
  type AssistantEntry,
  type AssistantListLink,
} from '@portfolio/velista/models';
import {
  appPath,
  AudioRecorder,
  BrowserFacade,
  PageNavigation,
} from '@portfolio/velista/platform';
import {
  AssistantComposer,
  AssistantIntro,
  AssistantMessage,
  ChevronLeftIcon,
  type AssistantLinkVm,
  type AssistantMessageVm,
} from '@portfolio/velista/ui';
import { AssistantStore } from '../assistant-store';

/**
 * The assistant, as a destination (plan 0032).
 *
 * ## A route, not a sheet
 *
 * The app bar is drawn on every signed in screen, so its button is everywhere, and
 * that is what decides this. Rule E1 (plan `0008`) makes a sheet a child route of the
 * page it covers, so a sheet reachable from everywhere would be a child of everywhere:
 * identical entries on every page that must not drift, for a panel that covers a page
 * it has nothing to do with.
 *
 * So it follows `account` (plan `0015`) instead, for the reasons that plan gave: it is
 * deep linkable, it has its own scroll, and it is somewhere somebody goes deliberately
 * rather than something drawn over what they were reading. A floating panel toggled by
 * a signal was rejected outright — nothing would be pushed onto the history stack, so
 * Android's back button would close the app rather than the panel, which is the defect
 * rule E1 exists to prevent and the one plan `0031` spent a whole plan repairing.
 *
 * ## Where the link comes from
 *
 * `reply.link`, and nowhere else (backend rule A3). It becomes a `routerLink` built
 * with `appPath`, never an assembled string: that helper is what makes one link correct
 * at `/velista/en/...` mounted in the portfolio shell and at `/en/...` on velista's own
 * origin. A hardcoded path is wrong in exactly one of the two run modes, and it is the
 * mode nobody looks at.
 *
 * There is one link and it always addresses a list (plan 0042, section 3). Whether to
 * name its zone is the server's decision and arrives as `zoneLabel`; nothing here
 * counts zones or composes that sentence.
 *
 * ## Only the last message may be answered
 *
 * A turn that ended with a question sends the answers to it, and they are drawn as
 * chips under the question. They are filled in here for the **last** entry only: an
 * answer to a question three turns ago is a wrong answer, and a chip that is still
 * tappable is a chip that invites it (section 4.3). The question itself stays
 * readable, which is what matters — it was asked in words and the words are still
 * there.
 *
 * ## The copy for what went wrong is chosen here
 *
 * `AssistantStore` leaves `text` empty on a `failed`, a `throttled` and a `dropped`,
 * because those are the app speaking rather than a person or the service. They are
 * localized from a key here like every other string. **The bot's replies are not**:
 * they arrive in the caller's language because the request carried `Accept-Language`,
 * and nothing here translates one (section 9).
 */
@Component({
  selector: 'lib-assistant-page',
  imports: [
    RokuTranslatorPipe,
    AssistantComposer,
    AssistantIntro,
    AssistantMessage,
    ChevronLeftIcon,
  ],
  templateUrl: './assistant-page.html',
  styleUrl: './assistant-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Both are scoped to this page and destroyed with it, which is what decides two
  // things the plan states as behaviour: the conversation survives leaving the panel
  // and coming back within a session and does not survive a reload (section 5), and a
  // message does not survive leaving mid capture, because destroying `AudioRecorder`
  // releases the microphone (section 12).
  //
  // Here rather than in the route's `providers`, which is where the plan puts the
  // store. Naming either class in `routes.ts` is an eager import of this library's
  // barrel, and that file is loaded before any page: the panel would land in the
  // shell's initial payload and `routes.spec.ts` would rightly fail its assertion that
  // every page is lazy. The lifetime is identical either way.
  providers: [AssistantStore, AudioRecorder],
})
export class AssistantPage {
  private readonly _store = inject(AssistantStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _browser = inject(BrowserFacade);

  private readonly _column = viewChild<ElementRef<HTMLElement>>('column');

  readonly composerDisabled = this._store.composerDisabled;

  /** The transcript, ready to draw. Empty means the intro is on screen instead. */
  readonly messages = computed<readonly AssistantMessageVm[]>(() => {
    // Read unconditionally, and this line is the reason: the app's own copy and every
    // link below depend on the locale, but a transcript with no link would not touch
    // it, so switching language would leave the failure messages in the old one.
    const locale = this._locale();
    const entries = this._store.entries();

    return entries.map((entry, index) =>
      this._toMessage(entry, locale, index === entries.length - 1)
    );
  });

  constructor() {
    // The column follows the newest message. `afterRenderEffect` because the bubble
    // has to be in the DOM before the scroller can be measured, and because it runs in
    // the browser and never on the server (plan 0001, D2).
    //
    // Every message and not only the caller's own, which is the opposite of the list
    // page's rule and correct for the opposite reason: there is nobody else writing
    // here, so a new bubble is always the answer this person is waiting for, and
    // leaving it below the fold would hide the thing they asked for.
    afterRenderEffect(() => {
      const count = this.messages().length;
      const column = this._column()?.nativeElement;

      if (count === 0 || column === undefined) {
        return;
      }

      const scroller =
        column.scrollHeight > column.clientHeight
          ? column
          : this._browser.document.scrollingElement;

      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
    });
  }

  /**
   * Back to wherever the person was.
   *
   * A pop and not a navigation to a fixed screen, because this panel is reached from
   * six different pages and sending everybody to the dashboard would take somebody
   * standing in an aisle away from the list they were shopping. A cold arrival on the
   * deep link has nothing behind it, so that one falls back to the dashboard.
   */
  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath, 'home'));
  }

  async send(text: string): Promise<void> {
    await this._store.say(text);
  }

  /**
   * A message spoken into the app's own microphone.
   *
   * Its own call rather than `send`, because the two requests genuinely differ: this
   * one carries a recording and no words, and the words come back on the reply
   * (backend `0041`). Everything after that is the same turn.
   */
  async spoke(recording: Blob): Promise<void> {
    await this._store.speak(recording);
  }

  private _toMessage(
    entry: AssistantEntry,
    locale: string,
    isLast: boolean
  ): AssistantMessageVm {
    const link = entry.link;

    return {
      speaker: entry.speaker,
      kind: entry.kind,
      text:
        entry.kind === 'said' || entry.kind === 'pending'
          ? entry.text
          : this._copyFor(entry),
      ...(link === null ? {} : { link: this._toLink(link, locale) }),
      // Section 4.3: chips on anything but the newest message are answers to a
      // question that has already been answered.
      choices: isLast ? entry.choices : [],
      // The chip group is labelled by the bubble above it, so the bubble needs an id
      // and only the one with chips under it needs one.
      ...(isLast && entry.choices.length > 0
        ? { bubbleId: `bubble-${entry.id}` }
        : {}),
      waitSeconds: entry.retryAfterSeconds,
    };
  }

  /**
   * What the app says when the service did not.
   *
   * A throttled turn reads differently depending on whether the server named a number,
   * and the difference is the whole of rule A5: with one, the message sits beside a
   * clock that shrinks; without one, it says the bot is busy and **invents no number**.
   */
  private _copyFor(entry: AssistantEntry): string {
    switch (entry.kind) {
      case 'throttled':
        return this._translator.t(
          entry.retryAfterSeconds === undefined
            ? 'assistant.busy.noNumber'
            : 'assistant.busy.body'
        );
      case 'unconfigured':
        return this._translator.t('assistant.unconfigured');
      case 'dropped':
        return this._translator.t('assistant.dropped');
      // The caller's own bubble for a turn they spoke, before the words come back
      // (backend `0041`, section 8.4). It says that something was said and is being
      // listened to, and it is what stays on screen when a reply carries no `heard`:
      // a placeholder is honest and a guess at what somebody said is not.
      case 'spoken':
        return this._translator.t('assistant.spoken');
      // The limit goes into the sentence, the way rule A5 puts the seconds into the
      // one about waiting. A refusal with no number in it is not an answer.
      case 'tooLong':
        // The values go in the fourth argument; the two before them are the
        // namespace and the locale, and both take their defaults here.
        return this._translator.t('assistant.tooLong', undefined, undefined, {
          limit: ASSISTANT_AUDIO_MAX_MB,
        });
      case 'badFormat':
        return this._translator.t('assistant.badFormat');
      default:
        return this._translator.t('assistant.failed');
    }
  }

  private _toLink(link: AssistantListLink, locale: string): AssistantLinkVm {
    return {
      label: link.label,
      zoneLabel: link.zoneLabel,
      path: appPath(
        locale,
        this._basePath,
        'zones',
        link.zoneId,
        'lists',
        link.listId
      ),
    };
  }
}
