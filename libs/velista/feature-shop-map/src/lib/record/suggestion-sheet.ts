import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { MapMark } from '@portfolio/luna-shopper/shop-map/model';
import { watchKeyboardInset } from '@portfolio/velista/platform';
import { CloseIcon, FlagIcon } from '@portfolio/velista/ui';
import { metresText } from '../edit/map-edits';
import { MARK_TEXT_MAX_LENGTH } from './mark-sheet';

/** A suggestion as the live map answers it, in metres. */
export interface ShelfSuggestion {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The section a suggestion takes from a mark nearby, and how far the mark is. */
export interface SuggestionSection {
  readonly name: string;
  readonly metres: number;
}

/** A section mark counts for a suggestion this close to it: the live map's reach. */
export const SUGGESTION_SECTION_REACH_METRES = 1.5;

/**
 * The section mark nearest a suggestion, within the live map's reach, or null.
 * Pure, so the spec reads it without a page.
 */
export function suggestionSection(
  suggestion: ShelfSuggestion,
  marks: readonly MapMark[]
): SuggestionSection | null {
  let best: SuggestionSection | null = null;
  for (const mark of marks) {
    if (mark.kind !== 'section' || !mark.text) {
      continue;
    }
    const dx = Math.max(suggestion.x - mark.x, 0, mark.x - (suggestion.x + suggestion.w));
    const dy = Math.max(suggestion.y - mark.y, 0, mark.y - (suggestion.y + suggestion.h));
    const metres = Math.hypot(dx, dy);
    if (
      metres <= SUGGESTION_SECTION_REACH_METRES &&
      (best === null || metres < best.metres)
    ) {
      best = { name: mark.text, metres };
    }
  }
  return best;
}

/** What the person chose. */
export type SuggestionAnswer =
  | { readonly fill: true; readonly section: string | null }
  | { readonly fill: false };

/**
 * "Is this a shelf?" (velista `0126`, target 4; the `Suggestion` board): why the
 * app thinks so and its size, the section it takes from a mark nearby with
 * Change, and "Not a shelf" or "Fill as shelf". A panel of the recording page,
 * like the mark sheet, with no scrim: the walk goes on behind it.
 */
@Component({
  selector: 'lib-suggestion-sheet',
  imports: [CloseIcon, FlagIcon, RokuTranslatorPipe],
  templateUrl: './suggestion-sheet.html',
  styleUrl: './suggestion-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closed.emit()',
  },
})
export class SuggestionSheet {
  readonly suggestion = input.required<ShelfSuggestion>();
  /** The section a mark nearby gives it, or null. */
  readonly section = input<SuggestionSection | null>(null);
  /** The names to pick from after Change: this walk's sections and the shop's. */
  readonly names = input<readonly string[]>([]);

  readonly answered = output<SuggestionAnswer>();
  readonly closed = output<void>();

  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly maxLength = MARK_TEXT_MAX_LENGTH;
  protected readonly changing = signal(false);
  private readonly _typed = signal<string | null>(null);

  /** The section the shelf is filled with: the one typed or picked, else the mark's. */
  protected readonly chosen = computed(
    () => this._typed() ?? this.section()?.name ?? null
  );

  protected readonly width = computed(() => {
    const s = this.suggestion();
    return metresText(Math.min(s.w, s.h), this._locale());
  });

  protected readonly length = computed(() => {
    const s = this.suggestion();
    return metresText(Math.max(s.w, s.h), this._locale());
  });

  protected readonly distance = computed(() => {
    const section = this.section();
    return section === null
      ? null
      : metresText(Math.max(0.5, Math.round(section.metres * 2) / 2), this._locale());
  });

  protected readonly inset = signal(0);

  constructor() {
    const stop = watchKeyboardInset(inject(DOCUMENT).defaultView, (inset) =>
      this.inset.set(inset.bottom)
    );
    inject(DestroyRef).onDestroy(stop);
  }

  protected change(): void {
    this.changing.set(true);
  }

  protected typed(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this._typed.set(value.length > 0 ? value : null);
  }

  protected pick(name: string): void {
    this._typed.set(name);
    this.changing.set(false);
  }

  protected fill(): void {
    this.answered.emit({ fill: true, section: this.chosen() });
  }

  protected notShelf(): void {
    this.answered.emit({ fill: false });
  }
}
