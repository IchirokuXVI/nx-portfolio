import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import type { SignInFailure } from '@portfolio/luna-shopper-admin/models';
import { EntryCard } from '@portfolio/luna-shopper-admin/ui';
import { signInMessage } from './sign-in-copy';

/**
 * How long this page waits before each new try of a passwordless sign in that
 * got no answer, in milliseconds (admin plan 0049, target 1).
 *
 * The first waits are short, because a backend that is starting answers
 * within seconds. After the last one the page goes on trying at that same
 * wait, for as long as it is on screen and the server still says that it
 * hands out a session: the owner's rule is that the form does not show on a
 * development server at all. Only an answer in words stops it.
 */
export const DEVELOPMENT_RETRY_WAITS_MS: readonly number[] = [
  1000, 2000, 4000, 8000,
];

/**
 * A username, a password, and a button (plan 0002, section 1).
 *
 * The first thing the app shows and the only thing it shows until it succeeds.
 *
 * **What is deliberately absent**, all of it decided by backend plan 0071: no
 * email, because an admin row has no email column; no "forgot password", because
 * recovery happens on the server by the person holding the server; no "create
 * account", because accounts are made by a command; and no third party sign in.
 * A screen offering a recovery flow that does not exist would be worse than one
 * offering nothing.
 *
 * **No "remember me" either.** The session is one short lived token with no
 * refresh token behind it, so a checkbox promising persistence would be lying.
 * What persistence there is, the token surviving a reload and reaching the other
 * tabs through `localStorage` (plan 0013), is not the operator's choice to make
 * and is not presented as one.
 *
 * The deployment is named on this screen and not only behind it, which is the
 * point of `0001`'s unauthenticated read: an operator should know which database
 * they are signing in to *before* they type a production password into a
 * staging tab, or the reverse. The card says the name above the form, and the
 * band above the card shows the color the rail takes once the operator is in
 * (admin plan 0046, target 8).
 *
 * **On a server that asks for no password this page signs in by itself**
 * (admin plan 0049, target 1). `SessionBootstrap` takes that session before
 * the first screen, and it tries once. When that one try got no answer, or
 * was never made because nothing answered at all, the operator was left on
 * this form in front of a server that would have let them in: a backend that
 * is still starting is the ordinary case, and so is one that restarts while
 * the tab is open. So the page asks whenever the server says it may, draws a
 * line that says so in place of the form, and goes on trying while
 * nothing answers. It is still the server that decides, through
 * `devAutologin`, and never the build. A sign in that the server refuses in
 * words puts the form back with the reason, which is the fallback `0002`
 * names.
 */
@Component({
  selector: 'lib-sign-in-page',
  imports: [FormsModule, RokuTranslatorPipe, EntryCard],
  template: `
    <!-- The color of the deployment, at the top edge of the page (admin plan
         0041, section 7): the same color the rail takes once the operator is
         in. It is decoration for a reader that cannot see it, because the
         card says the name of the deployment in words. -->
    <div aria-hidden="true" class="band"></div>

    <main>
      <lib-entry-card
        [deployment]="deployment()"
        [heading]="'signIn.heading' | rokuT"
        [level]="1"
        headingId="sign-in-heading"
        showDeployment
      >
        @if (entering()) {
          <!-- A server that asks for no password: the page is taking the
               session by itself, and there is nothing to type. -->
          <p role="status" data-entering>
            {{ 'signIn.development' | rokuT }}
          </p>
        } @else {
          <form (ngSubmit)="submit()" #form="ngForm" novalidate>
            <label for="username">{{ 'signIn.username' | rokuT }}</label>
            <input
              [(ngModel)]="username"
              [disabled]="busy()"
              autocapitalize="none"
              autocomplete="username"
              autocorrect="off"
              id="username"
              name="username"
              required
              spellcheck="false"
              type="text"
            />

            <label for="password">{{ 'signIn.password' | rokuT }}</label>
            <input
              [(ngModel)]="password"
              [disabled]="busy()"
              autocomplete="current-password"
              id="password"
              name="password"
              required
              type="password"
            />

            @if (message(); as copy) {
              <p class="entry-error" role="alert">
                {{ copy.key | rokuT: copy.args }}
              </p>
            }

            <button [disabled]="busy() || !complete()" type="submit">
              {{ (busy() ? 'signIn.submitting' : 'signIn.submit') | rokuT }}
            </button>
          </form>
        }
      </lib-entry-card>
    </main>
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
    }

    /* 8 px, in the navigation color. Before the deployment is known, and when
       it cannot be established, that token is the dark green grey that says
       nothing, so the band never shows a color the API did not name. */
    .band {
      block-size: 0.5rem;
      background: var(--admin-nav);
    }

    main {
      display: flex;
      /* Toward the top rather than centred: a software keyboard covering half
         the viewport must not push the fields off the screen, and a form pinned
         to the middle of a 300px tall visual viewport does exactly that. */
      align-items: flex-start;
      justify-content: center;
      min-block-size: 100%;
      padding: var(--admin-space-8) var(--admin-space-4);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  private readonly _sessions = inject(SessionStore);
  private readonly _deployments = inject(DeploymentStore);
  private readonly _router = inject(Router);

  readonly username = signal('');
  readonly password = signal('');

  /** In flight. Disables the form, so one submit cannot become three. */
  readonly busy = signal(false);

  /** The last refusal, or `null`. Cleared the moment another attempt starts. */
  readonly failure = signal<SignInFailure | null>(null);

  /** Which deployment is being signed in to, for the card. */
  readonly deployment = this._deployments.deployment;

  /**
   * The sentence for the current failure.
   *
   * Derived rather than stored, so the copy table stays the one place that
   * decides what a refusal reads like and the component holds only the refusal.
   */
  readonly message = computed(() => {
    const failure = this.failure();
    return failure === null ? null : signInMessage(failure);
  });

  /** Both fields have something in them. `required` is not enforcement. */
  readonly complete = computed(
    () => this.username().trim() !== '' && this.password() !== ''
  );

  /**
   * Whether the page is taking a passwordless session by itself, which is
   * drawn in place of the form.
   */
  readonly entering = signal(false);

  /** The wait before the next try, so that leaving the page cancels it. */
  private _retry: ReturnType<typeof setTimeout> | null = null;
  private _left = false;

  constructor() {
    // Whenever the server says it hands out a session with no password. That
    // is true from the start on a page reached after the one try of
    // `SessionBootstrap` failed, and it becomes true later on a page that was
    // drawn under the cover of an outage, when the server answers again and
    // the deployment is read a second time. `untracked`, because the sign in
    // writes signals this effect must not follow.
    effect(() => {
      const offered = this._deployments.devAutologin();
      untracked(() => {
        if (offered && !this.entering()) {
          void this._enter(0);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this._left = true;
      if (this._retry !== null) {
        clearTimeout(this._retry);
      }
    });
  }

  async submit(): Promise<void> {
    // Guards a submit from the Enter key, which reaches here regardless of the
    // button's disabled state.
    if (this.busy() || !this.complete()) {
      return;
    }

    this.busy.set(true);
    this.failure.set(null);

    const failure = await this._sessions.signIn(
      this.username().trim(),
      this.password()
    );

    this.busy.set(false);

    if (failure !== null) {
      this.failure.set(failure);
      // Cleared on every refusal, so a wrong password is not left in the field
      // for the next attempt, and the username is kept, because retyping it is
      // pure friction: it was almost certainly not the half that was wrong.
      this.password.set('');
      return;
    }

    await this._router.navigateByUrl('/');
  }

  /**
   * Take the session a server offers with no password, and go in.
   *
   * `attempt` counts the tries that got no answer. A try that the server
   * answered with a refusal is not tried again: the answer will not change,
   * and the form with its reason is where the operator should then be. A try
   * that got no answer is tried again after the wait
   * {@link DEVELOPMENT_RETRY_WAITS_MS} names, and after the last of those
   * waits at that same wait, with no end.
   *
   * **A session that is already held is used, and never asked for again.**
   * Another tab can sign in while this page waits, and the token is shared by
   * every tab. A try made then could fail, and a failed sign in clears the
   * shared token, which signs the other tab out. So the page looks before
   * each try, and goes in on what it finds.
   */
  private async _enter(attempt: number): Promise<void> {
    this._retry = null;
    if (this._left || this.busy()) {
      return;
    }

    if (this._sessions.signedIn()) {
      await this._router.navigateByUrl('/');
      return;
    }

    // The server stopped offering, which a deployment read again can say.
    if (!this._deployments.devAutologin()) {
      this.entering.set(false);
      return;
    }

    this.entering.set(true);
    this.failure.set(null);

    const failure = await this._sessions.signInForDevelopment();
    if (this._left) {
      return;
    }

    if (failure === null) {
      await this._router.navigateByUrl('/');
      return;
    }

    if (failure.reason === 'unknown') {
      const last = DEVELOPMENT_RETRY_WAITS_MS.length - 1;
      const wait = DEVELOPMENT_RETRY_WAITS_MS[Math.min(attempt, last)];
      this._retry = setTimeout(() => void this._enter(attempt + 1), wait);
      return;
    }

    this.entering.set(false);
    this.failure.set(failure);
  }
}
