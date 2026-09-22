import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  Injector,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ContactGroup } from '@portfolio/velista/models';

/** What a tick asks for: this person, in or out. */
export interface PeoplePickerToggle {
  readonly userId: string;
  readonly selected: boolean;
}

/** Only has to be unique per page, so the heading and hint ids never collide. */
let nextPickerId = 0;

/**
 * Choose people from the reader's groups (velista `0085`, section 2).
 *
 * One section per group, headed by the group's name, and a native checkbox per person
 * labelled with the name they carry in that group. Rule D1: it takes plain values and
 * emits a toggle, and the container decides what a toggle does.
 *
 * ## Selection is by person, not by row
 *
 * A person in two groups is drawn twice and chosen once, so both of their boxes read
 * the same `selected` set and a tick in one section ticks the other.
 *
 * ## The boxes are controlled
 *
 * A native checkbox flips itself before `change` fires, and `[checked]` only writes
 * when its bound value moves. So a tick the container refuses, or a save that fails,
 * would leave a box ticked over a model that says otherwise, and nothing would put it
 * back. So after the render that follows each change, the box is set to what `selected`
 * says. A tick the container takes has moved `selected` by then and the box stays put.
 * A refused tick returns. Optimism is the container's to add, by adding the person to
 * `selected` while the save is out.
 *
 * **After the render, not before the emit.** Writing the box back first made every
 * accepted tick draw unticked for the one frame before change detection caught up,
 * which a browser shows as a flicker and a spec calling `detectChanges` never sees.
 */
@Component({
  selector: 'lib-people-picker',
  imports: [RokuTranslatorPipe],
  templateUrl: './people-picker.html',
  styleUrl: './people-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeoplePicker {
  /** The reader's contacts, already grouped and sorted. */
  readonly groups = input.required<readonly ContactGroup[]>();

  /** The user ids that are chosen. */
  readonly selected = input.required<ReadonlySet<string>>();

  /** The user ids whose change is still being saved. */
  readonly busy = input<ReadonlySet<string>>(new Set());

  /**
   * A line under a person's name, **already translated**, per user id.
   *
   * A finished sentence rather than a key since velista `0094`: the one hint
   * this picker draws says when somebody's visit ends, so it interpolates a
   * time the container formats. A key would have forced the time in here, where
   * there is no locale and no reason to know what a visit is.
   */
  readonly hints = input<ReadonlyMap<string, string>>(new Map());

  /** Whether every box is read only, while the container submits. */
  readonly disabled = input(false);

  readonly toggled = output<PeoplePickerToggle>();

  protected readonly idPrefix = `people-picker-${nextPickerId++}`;

  private readonly _injector = inject(Injector);

  protected onChange(userId: string, event: Event): void {
    const box = event.target as HTMLInputElement;

    // To the model once the container's answer has rendered. See the class docs.
    afterNextRender(
      () => {
        box.checked = this.selected().has(userId);
      },
      { injector: this._injector }
    );

    if (this.busy().has(userId) || this.disabled()) {
      return;
    }

    this.toggled.emit({ userId, selected: box.checked });
  }
}
