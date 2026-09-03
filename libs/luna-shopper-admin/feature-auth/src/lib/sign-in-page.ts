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
import { EnvironmentBadge } from '@portfolio/luna-shopper-admin/ui';
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
 * What persistence there is, the token surviving a reload in `sessionStorage`,
 * is not the operator's choice to make and is not presented as one.
 *
 * The environment badge is on this screen and not only behind it, which is the
 * point of `0001`'s unauthenticated read: an operator should know which database
 * they are signing in to *before* they type a production password into a
 * staging tab, or the reverse.
 */
@Component({
  selector: 'lib-sign-in-page',
  imports: [FormsModule, RokuTranslatorPipe, EnvironmentBadge],
  template: `
    <main>
      <form (ngSubmit)="submit()" #form="ngForm" novalidate>
        <header>
          <h1>{{ 'signIn.heading' | rokuT }}</h1>
          <lib-environment-badge [deployment]="deployment()" />
        </header>

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
          <p class="error" role="alert">{{ copy.key | rokuT: copy.args }}</p>
        }

        <button [disabled]="busy() || !complete()" type="submit">
          {{ (busy() ? 'signIn.submitting' : 'signIn.submit') | rokuT }}
        </button>
      </form>
    </main>
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
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

    form {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      inline-size: 100%;
      max-inline-size: 22rem;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    header {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block-end: var(--admin-space-4);
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    label {
      margin-block-start: var(--admin-space-2);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    input {
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      font: inherit;
      font-size: 1rem;
      /* A comfortable touch target on a phone, and unremarkable on a desktop. */
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
    }

    input:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .error {
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-3);
      border-radius: var(--admin-radius);
      background: var(--admin-accent-wash);
      font-size: 0.875rem;
      color: var(--admin-ink);
    }

    button {
      margin-block-start: var(--admin-space-4);
      min-block-size: 2.75rem;
      border: 1px solid transparent;
      border-radius: var(--admin-radius);
      background: var(--admin-accent);
      font: inherit;
      font-weight: 600;
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
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

  /** Which environment is being signed in to, for the badge. */
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
