import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
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
}
