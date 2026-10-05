import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { SaveBarState } from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '../viewport';

/**
 * The one place Save and Cancel live (admin plan 0052, section 3.10).
 *
 * One bar at the bottom edge of the window while the page is a form. It says
 * what state the form is in, in words, and offers the two buttons. Seven pages
 * written by hand used to disagree about where Save is. A form of thirty
 * fields also has to say "2 unsaved changes" where the thirtieth field can
 * see it, so the bar sticks at every width.
 *
 * | State | The bar says | Save | Cancel |
 * | --- | --- | --- | --- |
 * | `clean` | "No changes yet" | off, or on with `canSave` | on |
 * | `dirty` | "2 unsaved changes" | on | on |
 * | `missing` | "* Required. 2 required fields are still empty." | off | on |
 * | `saving` | "Saving…", and the button says it too | off | off |
 * | `invalid` | "Not saved. 2 fields need a look.", and "Go to the first" | on | on |
 * | `refused` | "Not saved. Your changes are still here." | on | on |
 *
 * It holds nothing and saves nothing. It says what was pressed.
 *
 * On a phone there is no room for the words. Save takes the rest of the row
 * and carries the count, and the words are still said to a screen reader.
 * A saved form has no bar at all: the page reads again.
 *
 * **A form that is not a page says `sticky: false`** (admin plan 0060). The
 * form of a price rule is inside a row and the form of a price is inside a
 * panel. A bar at the edge of the window would be far from both, so there the
 * bar is the last line of the form.
 */
@Component({
  selector: 'lib-save-bar',
  imports: [RokuTranslatorPipe],
  host: { '[class.sticky]': 'sticky()' },
  template: `
    @let now = state();

    <!-- A refusal interrupts. Every other state waits its turn. -->
    <p
      [attr.role]="now.kind === 'invalid' ? 'alert' : 'status'"
      [class.problem]="now.kind === 'invalid' || now.kind === 'refused'"
      [class.sr-only]="compact()"
      class="words"
      data-save-words
    >
      @switch (now.kind) {
        @case ('clean') {
          {{ 'record.save.clean' | rokuT }}
        }
        @case ('dirty') {
          {{ 'record.save.dirty' | rokuT: { count: now.changes } }}
        }
        @case ('missing') {
          {{ 'record.save.missing' | rokuT: { count: now.required } }}
        }
        @case ('saving') {
          {{ 'resource.action.saving' | rokuT }}
        }
        @case ('invalid') {
          {{ 'record.save.invalid' | rokuT: { count: now.fields } }}
        }
        @case ('refused') {
          {{ 'record.save.refused' | rokuT }}
        }
      }
    </p>

    <!-- Outside the line above, so the alert is the sentence and not the
         sentence and a button. On a phone the page moves to the field by
         itself. -->
    @if (now.kind === 'invalid' && !compact()) {
      <button
        (click)="goToFirst.emit()"
        class="first"
        type="button"
        data-go-to-first
      >
        {{ 'record.save.goToFirst' | rokuT }}
      </button>
    }

    <span class="grow"></span>

    <button
      (click)="cancel.emit()"
      [disabled]="now.kind === 'saving'"
      type="button"
      data-cancel
    >
      {{ 'resource.action.cancel' | rokuT }}
    </button>
    <button
      (click)="save.emit()"
      [disabled]="!canSave()"
      class="primary"
      type="button"
      data-save
    >
      @if (now.kind === 'saving') {
        {{ 'resource.action.saving' | rokuT }}
      } @else if (now.kind === 'dirty' && compact()) {
        {{ 'record.save.saveCount' | rokuT: { count: now.changes } }}
      } @else {
        {{ saveLabel() }}
      }
    </button>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-block-size: 3.5rem;
      padding: var(--admin-space-2) var(--admin-page-inline);
      border-block-start: 1px solid var(--admin-border);
      background: var(--admin-surface-raised);
    }

    /* Above the bar of the app on a phone, where --admin-bar is its height,
       and at the very edge on a wide screen, where it is nothing. */
    :host(.sticky) {
      position: sticky;
      inset-block-end: var(--admin-bar);
      z-index: 20;
    }

    .words {
      min-inline-size: 0;
    }

    .words.problem {
      font-weight: 500;
      color: var(--admin-danger);
    }

    .grow {
      flex: 1;
    }

    button {
      flex: none;
      font-weight: 500;
      cursor: pointer;
    }

    .primary {
      border-color: var(--admin-accent);
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    /* Reads as a link, and is a button: it moves the focus and goes nowhere. */
    .first {
      padding-inline: var(--admin-space-1);
      border-color: transparent;
      background: none;
      text-decoration: underline;
      text-underline-offset: 0.1875rem;
      color: var(--admin-accent);
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    button:disabled {
      border-color: var(--admin-border-strong);
      background: var(--admin-neutral-wash);
      color: var(--admin-neutral-on-wash);
      cursor: default;
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media (max-width: 47.99rem) {
      :host {
        gap: var(--admin-space-2);
        min-block-size: 3.75rem;
      }

      .grow {
        display: none;
      }

      .primary {
        flex: 1;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveBar {
  /** What the form is in. */
  readonly state = input.required<SaveBarState>();
  /** The words of the button, already translated: "Save", "Add product". */
  readonly saveLabel = input.required<string>();
  /**
   * Whether the bar stays at the bottom edge of the window. `false` for a
   * form inside a row or a panel, where the bar is the last line of the form.
   */
  readonly sticky = input(true);

  readonly save = output<void>();
  // The name the plan gives it. It is the Cancel button and not the DOM event
  // of a dialog, which never reaches a custom element.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly cancel = output<void>();
  /** Asked to move to the first field that was refused. */
  readonly goToFirst = output<void>();

  private readonly _viewport = inject(Viewport);

  /** Whether the bar has no room for the words. */
  readonly compact = this._viewport.compact;

  /**
   * Whether Save can be pressed. Not with nothing to save, not with a required
   * field still empty, and not twice.
   */
  readonly canSave = computed(() => {
    const state = this.state();
    return (
      state.kind === 'dirty' ||
      state.kind === 'invalid' ||
      state.kind === 'refused' ||
      (state.kind === 'clean' && state.canSave === true)
    );
  });
}
