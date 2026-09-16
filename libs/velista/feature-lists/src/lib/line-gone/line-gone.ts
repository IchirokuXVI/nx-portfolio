import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  type Signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LineStore } from '@portfolio/velista/data-access';

/**
 * Why a sheet about a line says the line is gone (velista plan 0083).
 *
 * - `byOthers`: a `line.deleted` event removed it while this reader had a sheet about
 *   it open, or open underneath another one.
 * - `unavailable`: the list has loaded in full and the line is not on it, which is a
 *   link or a typed URL to a line deleted before the sheet was opened.
 *
 * A delete this reader made has no reason: the sheet closes without a word, because
 * the reader already knows.
 */
export type LineGoneReason = 'byOthers' | 'unavailable';

export interface LineGoneWatch {
  /** What to tell the reader, or null when there is nothing to tell. */
  readonly reason: Signal<LineGoneReason | null>;
  /** The reader closed the message. Later sheets about the line close quietly. */
  acknowledge(): Promise<void>;
}

/**
 * Watch the line a sheet is about, and close the sheet when the line goes.
 *
 * Called from a sheet's constructor. The sheet draws {@link LineGoneNotice} while
 * `reason` is set, and otherwise draws itself.
 *
 * ## Why it closes quietly for the reader's own delete
 *
 * A confirmed delete pops back to the detail sheet it was opened from, and that sheet
 * then pops itself. Back from the list then leaves the list, and a detail sheet about
 * a deleted line is never on screen. `mine` and `seen` close quietly, and only once:
 * two pops for one close would take the reader off the list as well.
 *
 * `paused` holds the close while the sheet is itself making the delete, which marks the
 * line as `mine` before the request goes out.
 */
export function watchLineGone(options: {
  readonly listId: Signal<string>;
  readonly lineId: Signal<string>;
  readonly close: () => Promise<void>;
  readonly paused?: Signal<boolean>;
}): LineGoneWatch {
  const lines = inject(LineStore);
  let closing = false;

  const status = computed(() => {
    const lineId = options.lineId();
    const known = lines.deletionOf(lineId);
    if (known !== null) {
      return known;
    }

    // Only a list read to its end can say a line is not on it. Before that, a line
    // that is not in the store is a line that has not arrived yet.
    const listId = options.listId();
    const absent =
      lines.stateOf(listId) === 'loaded' &&
      lines.isComplete(listId) &&
      !lines.linesIn(listId).some((line) => line.id === lineId);

    return absent ? 'unavailable' : null;
  });

  effect(() => {
    const now = status();
    const paused = options.paused?.() ?? false;
    if ((now !== 'mine' && now !== 'seen') || paused || closing) {
      return;
    }

    closing = true;
    untracked(() => void options.close());
  });

  return {
    reason: computed(() => {
      switch (status()) {
        case 'others':
          return 'byOthers';
        case 'unavailable':
          return 'unavailable';
        default:
          return null;
      }
    }),
    acknowledge: async () => {
      // Marked before closing, so the close that follows is the only one: the effect
      // above sees `seen` and would otherwise close a second time.
      closing = true;
      lines.acknowledgeDeletion(options.lineId());
      await options.close();
    },
  };
}

/**
 * What a sheet draws in place of itself when its line is gone.
 *
 * Content for a `SheetShell`, not a sheet of its own, so the sheet that was open stays
 * open and only its content changes. The heading carries the id the shell is labelled
 * by, because the heading it replaced did.
 */
@Component({
  selector: 'lib-line-gone-notice',
  imports: [RokuTranslatorPipe],
  template: `
    <h2 [id]="titleId()" class="title">
      {{
        (reason() === 'byOthers'
          ? 'list.gone.byOthers'
          : 'list.gone.unavailable'
        ) | rokuT
      }}
    </h2>
    <button (click)="closed.emit()" class="primary" type="button">
      {{ 'list.gone.close' | rokuT }}
    </button>
  `,
  styleUrl: './line-gone.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineGoneNotice {
  readonly reason = input.required<LineGoneReason>();
  readonly titleId = input.required<string>();
  readonly closed = output<void>();
}
