import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  SessionLifecycle,
  SIGN_IN_PATH,
} from '@portfolio/luna-shopper-admin/data-access';
import type { SignInFailure } from '@portfolio/luna-shopper-admin/models';
import { signInMessage } from './sign-in-copy';

/** Everything inside the overlay that a Tab can reach. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

/**
 * The session expired, and nothing was lost (plan 0003, section 5).
 *
 * This is the reason for the whole approach. The alternative, navigating to the
 * login route and preserving form state in a service, needs per form capture and
 * replay for every screen in the app and would be wrong somewhere. An overlay
 * needs none of it: nothing unmounts, nothing navigates, no component is
 * destroyed, and on success the app is exactly where it was, including a half
 * filled form.
 *
 * ## It is opaque, and that is a security property
 *
 * Not translucent, not blurred. A blur reads as obscured while staying legible
 * to a phone camera and trivially removable in devtools, which is the worst
 * combination: it feels safe and is not. The threat is somebody looking at an
 * unattended screen, and an opaque cover answers it completely. `opaque
 * overlay.spec.ts` asserts that no alpha colour, blur or opacity ever appears in
 * these styles.
 *
 * ## And it traps focus
 *
 * Two things, for two different readers. The content behind is marked `inert` by
 * the app root, which takes it out of the tab order and out of the accessibility
 * tree, so a screen reader cannot be walked through the very content the overlay
 * exists to hide. The Tab handling below wraps focus inside the form as well,
 * because `inert` is one attribute away from being removed by a future edit and
 * this is the half that fails loudly in a test.
 *
 * ## The known limit
 *
 * The covered content is still in the DOM, and somebody with devtools can read
 * it. That is the accepted residual, recorded in the plan rather than
 * discovered later: removing it means destroying the components and holding form
 * state outside them, which is exactly the machinery this design exists to
 * avoid. The threat model is a glance at a screen, not an attacker at the
 * keyboard.
 */
@Component({
  selector: 'lib-reauth-overlay',
  imports: [FormsModule, RokuTranslatorPipe],
  template: `
    <form (ngSubmit)="submit()" novalidate>
      <h2 id="reauth-heading">{{ 'session.reauth.heading' | rokuT }}</h2>
      <p>{{ 'session.reauth.body' | rokuT: { name: username() } }}</p>

      <label for="reauth-password">{{
        'session.reauth.password' | rokuT
      }}</label>
      <input
        [(ngModel)]="password"
        [disabled]="busy()"
        #passwordField
        autocomplete="current-password"
        id="reauth-password"
        name="password"
        required
        type="password"
      />

      @if (message(); as copy) {
        <p class="error" role="alert">{{ copy.key | rokuT: copy.args }}</p>
      }

      <button [disabled]="busy() || password() === ''" type="submit">
        {{
          (busy() ? 'session.reauth.submitting' : 'session.reauth.submit')
            | rokuT
        }}
      </button>

      <!-- The one way out, and the one path in this design that loses work.
           Deliberately a secondary control and deliberately present: an operator
           who cannot remember the password must not be stuck in front of an
           overlay with no exit. -->
      <button
        (click)="signOut()"
        [disabled]="busy()"
        class="quiet"
        type="button"
      >
        {{ 'session.reauth.signOut' | rokuT }}
      </button>
    </form>
  `,
  host: {
    '(keydown)': 'onKeydown($event)',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'reauth-heading',
  },
  styles: `
    :host {
      position: fixed;
      z-index: 100;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      inset: 0;
      /* Opaque, and stated as one flat token with no alpha channel. Anything
         translucent here would be a security regression, not a style change. */
      background: var(--admin-surface);
      padding: var(--admin-space-8) var(--admin-space-4);
      /* The covered page keeps its scroll position; the overlay is what scrolls
         if a software keyboard leaves it taller than the viewport. */
      overflow-y: auto;
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

    h2 {
      font-size: 1.25rem;
      font-weight: 700;
    }

    p {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
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

    button.quiet {
      margin-block-start: var(--admin-space-2);
      border-color: var(--admin-border);
      background: var(--admin-surface-raised);
      font-weight: 500;
      color: var(--admin-ink-muted);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReauthOverlay implements AfterViewInit {
  private readonly _lifecycle = inject(SessionLifecycle);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _router = inject(Router);

  private readonly _passwordField =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordField');

  /** Who the expired token belonged to. Never asked for again: only the password is. */
  readonly username = this._lifecycle.lockedUsername;

  readonly password = signal('');
  readonly busy = signal(false);
  readonly failure = signal<SignInFailure | null>(null);

  /**
   * The sentence for the current refusal, through the **same** table the login
   * screen uses. A wrong password reads identically in both places, and a lockout
   * that happens here says the same thing it says there.
   */
  readonly message = computed(() => {
    const failure = this.failure();
    return failure === null ? null : signInMessage(failure);
  });

  ngAfterViewInit(): void {
    // The cursor lands in the field that is being asked for. Without it focus is
    // wherever the covered page left it, which is behind an `inert` subtree and
    // therefore nowhere at all.
    this._passwordField().nativeElement.focus();
  }

  async submit(): Promise<void> {
    // Guards a submit from the Enter key, which reaches here regardless of the
    // button's disabled state.
    if (this.busy() || this.password() === '') {
      return;
    }

    this.busy.set(true);
    this.failure.set(null);

    const failure = await this._lifecycle.reauthenticate(this.password());

    this.busy.set(false);

    if (failure !== null) {
      this.failure.set(failure);
      // Cleared on every refusal, so a wrong password is not left in a field on
      // an unattended screen.
      this.password.set('');
      return;
    }

    // Nothing else to do. The overlay is gone because the session is back, and
    // the app underneath was never disturbed.
  }

  /**
   * Give up (plan 0003, sections 6 and 7).
   *
   * The queued requests fail, the token is dropped, and this is the navigation
   * that takes the operator to the login screen: the lifecycle deliberately owns
   * no router, so leaving is a decision made by the screen rather than by a
   * service in `data-access`.
   */
  async signOut(): Promise<void> {
    this._lifecycle.signOut();
    await this._router.navigateByUrl(`/${SIGN_IN_PATH}`);
  }

  onKeydown(event: KeyboardEvent): void {
    // Escape does not dismiss this. There is nothing to go back to: the token is
    // gone either way, and a key that looked like a cancel would either lose the
    // work or, worse, uncover the screen the overlay is hiding.
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = Array.from(
      this._host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)
    );
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this._host.nativeElement.ownerDocument.activeElement;

    // Only the two ends are handled. Everything between them is the browser's own
    // tab order, which is the one worth keeping.
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
