import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ServerReachability,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';

/**
 * The gateway stopped answering, and nothing was lost (plan 0008, sections 4
 * and 5).
 *
 * The same act as `0003`'s re-authentication overlay, for a second cause. An
 * expired session and an absent server are different problems with the same
 * correct answer: cover the screen exactly as it stands, unmount nothing,
 * navigate nowhere, and capture no form state, because none of it is touched.
 *
 * ## It has no inputs, and that is the point
 *
 * There is nothing to type. A password field over a server that cannot check one
 * is a prompt that fails on submit, so this asks for nothing and offers the one
 * control that can help: ask the server again.
 *
 * When the probe succeeds this component is removed. What the operator sees next
 * is decided by `0003`, and both answers are correct: their screen exactly as
 * they left it when the token outlived the outage, or the password prompt with
 * their username already on it when it did not.
 *
 * ## The reload warning
 *
 * Reloading is the one act available to somebody looking at a stuck page that
 * throws away everything this cover protects, and it is the first thing most
 * people try. So the cover says not to, in as many words, and says it only when
 * there is a session: a reload before sign in loses nothing.
 *
 * ## Opaque, and focused
 *
 * Opaque for the reason the re-authentication overlay is: a blur reads as
 * obscured while staying legible to a phone camera and trivially removable in
 * devtools. The page behind is marked `inert` by the app root, and the one
 * button here takes focus, so a keyboard cannot walk into the covered screen.
 * There is no focus trap to write, because a single control cannot be tabbed
 * away from within this subtree.
 */
@Component({
  selector: 'lib-server-down-overlay',
  imports: [RokuTranslatorPipe],
  template: `
    <section>
      <h2 id="server-down-heading">{{ 'serverDown.heading' | rokuT }}</h2>
      <p>{{ 'serverDown.body' | rokuT }}</p>

      @if (signedIn()) {
        <p class="warning" role="alert">
          {{ 'serverDown.doNotReload' | rokuT }}
        </p>
      }

      <p class="status">
        @if (checking()) {
          {{ 'serverDown.checking' | rokuT }}
        } @else if (exhausted()) {
          {{ 'serverDown.stopped' | rokuT }}
        } @else {
          {{ 'serverDown.retriesLeft' | rokuT: { count: attemptsLeft() } }}
        }
      </p>

      <button
        (click)="retry()"
        [disabled]="checking()"
        #retryButton
        type="button"
      >
        {{ (checking() ? 'serverDown.checking' : 'serverDown.retry') | rokuT }}
      </button>
    </section>
  `,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'server-down-heading',
  },
  styles: `
    :host {
      position: fixed;
      /* Above the re-authentication overlay, which can be up underneath: an
         outage long enough to notice is long enough for the token to expire
         behind it. */
      z-index: 200;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      inset: 0;
      /* Opaque, and stated as one flat token with no alpha channel. Anything
         translucent here would be a security regression, not a style change. */
      background: var(--admin-surface);
      padding: var(--admin-space-8) var(--admin-space-4);
      overflow-y: auto;
    }

    section {
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

    .warning {
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-3);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      font-weight: 600;
      color: var(--admin-ink);
    }

    .status {
      margin-block-start: var(--admin-space-3);
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

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerDownOverlay implements AfterViewInit {
  private readonly _reachability = inject(ServerReachability);
  private readonly _sessions = inject(SessionStore);

  private readonly _retryButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('retryButton');

  /** Whether a probe is in flight. The button says so and refuses a second. */
  readonly checking = this._reachability.checking;

  /** How many probes the app will still make on its own. */
  readonly attemptsLeft = this._reachability.automaticAttemptsLeft;

  /** Whether the app has stopped asking, leaving the button as the only way. */
  readonly exhausted = this._reachability.exhausted;

  /** Whether there is work behind the cover that a reload throws away. */
  readonly signedIn = computed(() => this._sessions.signedIn());

  ngAfterViewInit(): void {
    // Focus lands on the one control there is. Without this it stays wherever
    // the covered page left it, which is inside an `inert` subtree and therefore
    // nowhere at all.
    this._retryButton().nativeElement.focus();
  }

  async retry(): Promise<void> {
    if (this.checking()) {
      return;
    }
    await this._reachability.retry();
  }
}
