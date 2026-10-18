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
  GatewayError,
  SessionStore,
  type BasketServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LINK_VISIT_HOURS,
  type BasketLinkPreview,
} from '@portfolio/velista/models';
import { appPath, InstallStore } from '@portfolio/velista/platform';
import { basketPath } from '../basket-paths';

/**
 * How the screen is getting on, which is the whole of what it branches on.
 *
 * `unreachable` is a preview that never answered, and `removed` is a signed in
 * reader the basket refused (velista `0154`).
 */
type JoinState =
  | 'checking'
  | 'unreachable'
  | 'offering'
  | 'dead'
  | 'joining'
  | 'failed'
  | 'removed';

/**
 * The shape of a whole link secret: 32 random bytes as base64url, which the backend
 * mints (`randomBytes(32).toString('base64url')`).
 *
 * Read only to choose a sentence on a dead link (velista `0154`, target 4). A
 * secret of another shape was cut short on its way here, and "no longer accepting
 * people" would be false of it. It never decides whether to ask the server.
 */
const WHOLE_SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * The first thing a stranger sees (plan 0044, section 3).
 *
 * ## The hierarchy is decided, not discovered
 *
 * Top to bottom: what this list is, an optional name, and **"Continue as guest"
 * as the primary action of the page**. Sign in sits below it and visibly
 * secondary; the install prompt is lower still.
 *
 * A person holding a real list in a real shop is the most engaged user velista
 * will ever have, and making them register would kill the feature that got them
 * there. So the guest path is the way in, and nothing here offers register
 * (velista `0154`, target 3): an account can be made later from the account
 * page, and upgrade keeps the memberships (rule C2). The Google button went with
 * it, because it opened register and no Google sign in exists yet.
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
 * sentence, and one action that leaves for the app (velista `0154`). The only
 * other sentence is for a secret of the wrong shape, which the server never saw
 * as a link, so telling it apart leaks nothing.
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
  private readonly _secret = this._route.snapshot.paramMap.get('secret') ?? '';

  private readonly _state = signal<JoinState>('checking');
  private readonly _preview = signal<BasketLinkPreview>({ joinable: false });

  protected readonly state = this._state.asReadonly();
  protected readonly preview = this._preview.asReadonly();

  /** Whether the reader is signed in, who is never offered the guest path. */
  protected readonly signedIn = this._session.isAuthenticated;

  /**
   * Whether the secret is the shape a whole link has, which only chooses the
   * sentence a dead link says. See {@link WHOLE_SECRET}.
   */
  protected readonly incomplete = !WHOLE_SECRET.test(this._secret);

  /** What the guest typed. Never trimmed into a name here; the API does that. */
  protected readonly name = signal('');

  /** Whether an install can be offered at all, which most browsers answer no to. */
  protected readonly canInstall = this._install.canPrompt;

  /**
   * How long the link buys whoever opens it (velista `0094`, section 4).
   *
   * From the constant rather than written into the sentence, so the day the
   * number changes it changes in one place. A plain field: it is a fact about
   * the product and never moves while this page is open.
   */
  protected readonly visitHours = LINK_VISIT_HOURS;

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

    let preview: BasketLinkPreview;
    try {
      preview = await this._service.previewLink(this._secret);
    } catch {
      // F6.5: the preview never fails on purpose (backend `0051`, section 4), so
      // a rejection is the network or the server. It says so and offers the one
      // thing that can help, rather than a spinner that never ends.
      this._state.set('unreachable');
      return;
    }
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
        basketPath(this._locale(), this._basePath, {
          basketId: session.basketId,
        })
      );
    } catch (error) {
      this._state.set(this._failedJoin(error));
    }
  }

  /**
   * Which state a refused join lands on (velista `0154`, target 2).
   *
   * A signed in reader the basket refuses by name was taken off it, and the link
   * cannot undo that (backend `0140`, section 5). A 404 is the link dying between
   * the preview and the tap, which is the dead link. Anything else is a hiccup:
   * the line saying it did not work stays, so the obvious second tap is there.
   */
  private _failedJoin(error: unknown): JoinState {
    if (
      error instanceof GatewayError &&
      error.code === 'not_a_participant' &&
      this.signedIn()
    ) {
      return 'removed';
    }
    if (error instanceof GatewayError && error.status === 404) {
      return 'dead';
    }
    return 'failed';
  }

  /** Ask about the link again, after a preview that never answered. */
  protected retryCheck(): void {
    this._state.set('checking');
    void this._check();
  }

  /**
   * Where "Open Velista" and "Go home" go: home for an account, the front door
   * for anybody else. The front door's own guard would send an account home
   * anyway, and saying so here saves a redirect.
   */
  protected goHome(): void {
    void this._router.navigateByUrl(
      this.signedIn()
        ? appPath(this._locale(), this._basePath, 'home')
        : appPath(this._locale(), this._basePath)
    );
  }

  /** Offer the install, from inside the tap, because the prompt needs a gesture. */
  protected async install(): Promise<void> {
    await this._install.prompt();
  }

  /**
   * Sign in, and come back to this link (velista `0154`, target 5).
   *
   * The sign in page reads `returnUrl` and lands here again, where a signed in
   * reader is joined as themselves without a prompt.
   */
  protected signIn(): void {
    void this._router.navigate(
      [appPath(this._locale(), this._basePath, 'auth', 'login')],
      {
        queryParams: {
          returnUrl: appPath(this._locale(), this._basePath, 's', this._secret),
        },
      }
    );
  }
}
