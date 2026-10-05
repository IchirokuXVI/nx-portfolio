import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';

/**
 * The card of the three screens that stand in front of the app (admin plan
 * 0046, target 8): the sign in page, the session ended cover and the server
 * down cover.
 *
 * Each of the three carried its own copy of the same card, field, button and
 * error styles, and the copies had already drifted: an error was drawn on the
 * accent wash, which is the wash of a good state. The styles are here once.
 *
 * ## What a screen hands it
 *
 * ```html
 * <lib-entry-card [heading]="'signIn.heading' | rokuT" showDeployment>
 *   <form (ngSubmit)="submit()">
 *     <label for="username">Username</label>
 *     <input id="username" />
 *     <p class="entry-error" role="alert">That did not match.</p>
 *     <button type="submit">Sign in</button>
 *     <button class="entry-quiet" type="button">Sign out</button>
 *   </form>
 * </lib-entry-card>
 * ```
 *
 * A `label`, an `input`, a `button` and a `p` inside the card take the card's
 * look with no class. Three classes name what an element cannot say by itself:
 * `entry-error` for a refusal, `entry-warning` for an effect that loses work,
 * and `entry-quiet` for a second button.
 *
 * The styles reach the projected elements on purpose. The fields belong to the
 * screen, which binds them, and their look belongs to the card.
 *
 * ## The deployment
 *
 * The sign in page asks for it with `showDeployment`: the name of the
 * deployment above the heading, on the navigation color, which is the color of
 * the rail the operator sees once inside. An operator must know which database
 * a password opens before typing it. A deployment that could not be
 * established says so in a sentence, because that is a state to act on.
 *
 * ## Opaque
 *
 * The card draws no page ground. The two covers are fixed over the app and
 * paint their own flat ground, and the reason they are opaque is recorded in
 * them.
 */
@Component({
  selector: 'lib-entry-card',
  imports: [RokuTranslatorPipe],
  template: `
    <section [attr.aria-labelledby]="headingId()" class="entry-card">
      @if (showDeployment()) {
        @if (deployment() === undefined) {
          <p class="entry-checking">{{ 'environment.checking' | rokuT }}</p>
        } @else {
          <p class="entry-deployment">
            <span class="entry-sr-only"
              >{{ 'environment.label' | rokuT }}:</span
            >
            {{ deploymentKey() | rokuT }}
          </p>
          @if (deployment() === null) {
            <p class="entry-unknown">
              {{ 'environment.unknownExplanation' | rokuT }}
            </p>
          }
        }
      }

      @if (level() === 1) {
        <h1 [id]="headingId()" class="entry-heading">{{ heading() }}</h1>
      } @else {
        <h2 [id]="headingId()" class="entry-heading">{{ heading() }}</h2>
      }

      <ng-content />
    </section>
  `,
  styles: `
    :host {
      display: block;
      inline-size: 100%;
      max-inline-size: 22rem;
    }

    .entry-card,
    :host ::ng-deep form {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .entry-card {
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .entry-heading {
      margin-block-end: var(--admin-space-2);
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    /* The name of the deployment, on the color the rail takes. The same pair
       as an entry of the rail at rest, so the contrast is already proved. */
    .entry-deployment {
      align-self: flex-start;
      padding: 0.1875rem 0.5rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-nav);
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--admin-nav-ink);
    }

    .entry-checking,
    .entry-unknown {
      font-size: 0.875rem;
    }

    .entry-checking {
      color: var(--admin-ink-muted);
    }

    .entry-unknown {
      color: var(--admin-ink);
    }

    .entry-sr-only {
      position: absolute;
      overflow: hidden;
      clip-path: inset(50%);
      inline-size: 1px;
      block-size: 1px;
      white-space: nowrap;
    }

    :host ::ng-deep p {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    :host ::ng-deep label {
      margin-block-start: var(--admin-space-2);
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    :host ::ng-deep input {
      /* 16 px on a phone, through the token: iOS Safari zooms the viewport on
         focus for anything smaller, which leaves the operator scrolled
         sideways. */
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: var(--admin-field-size);
      color: var(--admin-ink);
    }

    :host ::ng-deep input:focus-visible,
    :host ::ng-deep button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    /* A refusal, and an effect that loses work: red, which on the page means
       danger and nothing else. */
    :host ::ng-deep .entry-error,
    :host ::ng-deep .entry-warning {
      margin-block-start: var(--admin-space-3);
      padding: var(--admin-space-3);
      border-radius: var(--admin-radius-control);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    :host ::ng-deep .entry-warning {
      font-weight: 600;
    }

    :host ::ng-deep button {
      min-block-size: var(--admin-control);
      margin-block-start: var(--admin-space-4);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius-control);
      background: var(--admin-accent);
      font: inherit;
      font-weight: 600;
      color: var(--admin-accent-ink);
      cursor: pointer;
    }

    :host ::ng-deep button.entry-quiet {
      margin-block-start: var(--admin-space-2);
      border-color: var(--admin-border-strong);
      background: var(--admin-surface-raised);
      font-weight: 500;
      color: var(--admin-ink);
    }

    /* Off, and said without transparency: the card is drawn over the two
       covers, which are opaque by rule, and its spec holds it to the same. */
    :host ::ng-deep button:disabled {
      border-color: var(--admin-border);
      background: var(--admin-neutral-wash);
      color: var(--admin-neutral-on-wash);
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryCard {
  /** The title of the card, already translated. */
  readonly heading = input.required<string>();
  /** The id of the heading, which a cover names itself by. */
  readonly headingId = input('entry-card-heading');
  /**
   * 1 where the card is the page, which is the sign in page. 2 where it is a
   * cover over a page that has its own first heading.
   */
  readonly level = input<1 | 2>(2);
  /** Whether the deployment is named above the heading. */
  readonly showDeployment = input(false, { transform: booleanAttribute });
  /** The deployment, `null` if it could not be established, `undefined` while asking. */
  readonly deployment = input<Deployment | null | undefined>(undefined);

  /**
   * The key for the name of the deployment, as the rail writes it.
   *
   * A key per deployment, so a name this app does not know cannot reach the
   * screen as raw text from the API.
   */
  readonly deploymentKey = computed(
    () => `environment.short.${this.deployment() ?? 'unknown'}`
  );
}
