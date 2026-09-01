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
  BASKET_SERVICE,
  SessionStore,
  type BasketServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type BasketLinkPreview,
} from '@portfolio/velista/models';
import { appPath, InstallStore } from '@portfolio/velista/platform';
import { basketPath } from '../basket-paths';

/** How the screen is getting on, which is the whole of what it branches on. */
type JoinState = 'checking' | 'offering' | 'dead' | 'joining' | 'failed';

/**
 * The first thing a stranger sees (plan 0044, section 3).
 *
 * ## The hierarchy is decided, not discovered
 *
 * Top to bottom: what this list is, an optional name, and **"Continue as guest"
 * as the primary action of the page**. Sign in and register sit below it and
 * visibly secondary; the install prompt is lower still.
 *
 * This is the app's best acquisition moment and the plan is deliberate about not
 * spending it: a person holding a real list in a real shop is the most engaged
 * user velista will ever have, and making them register would kill the feature
 * that got them there. Register is offered because this is the right moment to
 * offer it, and it is never a step.
 *
 * ## The name field is optional and looks it
 *
 * The word "Optional" is on the field rather than buried in a hint, and somebody
 * who skips it becomes `Guest N` with nothing about their experience degraded.
 * An empty string is sent as **absence** rather than as a name, because the
 * server reads absence as "give them a number".
 *
 * ## The preview discloses nothing, and neither does the failure
 *
 * The name, the head count and whether it still accepts people. No lines, no
 * zone, no list names, no members (backend `0051`, section 4).
 *
 * A revoked link, an expired one, one whose basket is finished and one that never
 * existed all reach {@link JoinState} `dead`, and this screen **must not try to
 * tell them apart**: it cannot, because they answer identically, and that
 * indistinguishability is the security property (section 3.1). So there is one
 * sentence, and it offers nothing to try.
 *
 * ## Somebody already signed in does not see this screen
 *
 * They are attached as themselves and land in the basket. The join still happens
 * — a registered participant is a row like any other — it simply happens without
 * a prompt, because there is nothing to ask them.
 */
@Component({
  selector: 'lib-join-page',
  imports: [RokuTranslatorPipe],
  templateUrl: './join-page.html',
  styleUrl: './join-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinPage {
  private readonly _service = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _session = inject(SessionStore);
  private readonly _install = inject(InstallStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /**
   * The link secret, from the snapshot.
   *
   * Arriving here creates this component, so there is no later value to miss, and
   * a subscription would be one that fires exactly once.
   */
  private readonly _secret =
    this._route.snapshot.paramMap.get('secret') ?? '';

  private readonly _state = signal<JoinState>('checking');
  private readonly _preview = signal<BasketLinkPreview>({ joinable: false });

  protected readonly state = this._state.asReadonly();
  protected readonly preview = this._preview.asReadonly();

  /** What the guest typed. Never trimmed into a name here; the API does that. */
  protected readonly name = signal('');

  /** Whether an install can be offered at all, which most browsers answer no to. */
  protected readonly canInstall = this._install.canPrompt;

  /**
   * The head count, only when the link is live.
   *
   * Zero rather than absent when the server did not say, so the template has one
   * shape: the count is drawn only above zero anyway.
   */
  protected readonly peopleCount = computed(
    () => this._preview().participantCount ?? 0
  );

  constructor() {
    void this._check();
  }

  /**
   * Look at the link, and take the two shortcuts that skip this screen.
   *
   * A browser that already holds a credential for this basket, and a reader who
   * is already signed in, both go straight through. Neither has anything to be
   * asked: the first is already a participant, and the second is attached as
   * themselves.
   */
  private async _check(): Promise<void> {
    if (this._secret === '') {
      this._state.set('dead');
      return;
    }

    const preview = await this._service.previewLink(this._secret);
    this._preview.set(preview);

    if (!preview.joinable) {
      // One state for four causes, on purpose. See the class comment.
      this._state.set('dead');
      return;
    }

    if (this._session.isAuthenticated()) {
      // Section 3: somebody already signed in is attached as themselves and never
      // sees this screen.
      await this.join();
      return;
    }

    this._state.set('offering');
  }

  /**
   * Become a participant and go to the basket.
   *
   * The session is persisted by `BasketApi.join`, not here, because the secret
   * exists exactly once and a screen that forgot it would make the person a
   * stranger to this basket with no way back.
   */
  protected async join(): Promise<void> {
    this._state.set('joining');
    try {
      const session = await this._service.join(this._secret, this.name());
      await this._router.navigateByUrl(
        basketPath(this._locale(), this._basePath, session.generatedListId)
      );
    } catch {
      // A link that died between the preview and the tap lands here, and so does
      // a lost network. Neither is worth distinguishing on a phone in a shop: the
      // offer stays on screen with a line saying it did not work, so the obvious
      // second tap is available.
      this._state.set('failed');
    }
  }

  /** Offer the install, from inside the tap, because the prompt needs a gesture. */
  protected async install(): Promise<void> {
    await this._install.prompt();
  }

  protected signIn(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'auth', 'login')
    );
  }

  protected register(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'auth', 'register')
    );
  }
}
