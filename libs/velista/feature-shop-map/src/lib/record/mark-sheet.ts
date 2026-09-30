import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { MarkKind } from '@portfolio/luna-shopper/shop-map/model';
import { watchKeyboardInset } from '@portfolio/velista/platform';
import { CloseIcon, InfoIcon } from '@portfolio/velista/ui';
import type { RecordingPointing } from './walk-recording';

/** The three kinds of mark, in the order the sheet offers them. */
export const MARK_KINDS: readonly MarkKind[] = ['section', 'counter', 'note'];

/** The longest name or note a mark takes. */
export const MARK_TEXT_MAX_LENGTH = 80;

/** What Save hands back. */
export interface MarkSaved {
  readonly kind: MarkKind;
  readonly text: string;
}

/**
 * The mark sheet (velista `0126`, target 3; the `Mark` board): "Point your phone
 * at what you mark" with where it points now, the kind, the name, the names used
 * for this kind in this walk and, for a section, the shop's own sections, as
 * chips that scroll sideways. The mark is made when Save is tapped, where the
 * phone is and the way it points then.
 *
 * **Save is never hidden.** Inside WebXR's DOM overlay nothing scrolls, so the
 * sheet and its Save bar sit on a layer whose foot follows the top of the on
 * screen keyboard (`watchKeyboardInset`): Save is always the last thing above it.
 *
 * A panel of the recording page rather than a route of its own, because the walk
 * goes on under it and the page must keep drawing it (see the plan's decisions).
 */
@Component({
  selector: 'lib-mark-sheet',
  imports: [CloseIcon, InfoIcon, RokuTranslatorPipe],
  templateUrl: './mark-sheet.html',
  styleUrl: './mark-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'closed.emit()',
  },
})
export class MarkSheet {
  /** The kind the sheet opens on: the button that opened it. */
  readonly kind = input.required<MarkKind>();

  /** The names used in this walk, newest first, by kind. */
  readonly recent = input<Readonly<Record<MarkKind, readonly string[]>>>({
    section: [],
    counter: [],
    note: [],
  });

  /** The shop's own sections, for a section mark. */
  readonly sections = input<readonly string[]>([]);

  /** Where the phone points now, or null when that is not known yet. */
  readonly pointing = input<RecordingPointing | null>(null);

  readonly saved = output<MarkSaved>();
  readonly closed = output<void>();

  protected readonly maxLength = MARK_TEXT_MAX_LENGTH;
  protected readonly kinds = MARK_KINDS;

  private readonly _chosen = signal<MarkKind | null>(null);
  protected readonly current = computed(() => this._chosen() ?? this.kind());
  protected readonly text = signal('');
  protected readonly canSave = computed(() => this.text().trim().length > 0);

  protected readonly recentNames = computed(() => {
    const kind = this.current();
    return this.recent()[kind] ?? [];
  });

  /** The shop's sections not already among the recent names. */
  protected readonly shopSections = computed(() => {
    if (this.current() !== 'section') {
      return [];
    }
    const recent = new Set(
      this.recentNames().map((name) => name.trim().toLowerCase())
    );
    return this.sections().filter(
      (name) => !recent.has(name.trim().toLowerCase())
    );
  });

  protected readonly inset = signal(0);
  protected readonly room = signal<number | null>(null);

  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    const stop = watchKeyboardInset(inject(DOCUMENT).defaultView, (inset) => {
      this.inset.set(inset.bottom);
      this.room.set(inset.height > 0 ? inset.height : null);
    });
    inject(DestroyRef).onDestroy(stop);
    afterNextRender(() => this._field()?.nativeElement.focus());
  }

  protected choose(kind: MarkKind): void {
    this._chosen.set(kind);
  }

  protected typed(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected pick(name: string): void {
    this.text.set(name.slice(0, MARK_TEXT_MAX_LENGTH));
    this._field()?.nativeElement.focus();
  }

  protected save(event?: Event): void {
    event?.preventDefault();
    const text = this.text().trim();
    if (text.length === 0) {
      return;
    }
    this.saved.emit({ kind: this.current(), text });
  }
}
