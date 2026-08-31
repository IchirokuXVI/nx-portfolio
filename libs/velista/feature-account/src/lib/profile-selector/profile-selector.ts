import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ShoppingProfile } from '@portfolio/velista/models';
import { ChevronDownIcon, PlusIcon, TrashIcon } from '@portfolio/velista/ui';

/**
 * Which profile is being edited, and the two things you can do to the set (plan 0046,
 * section 3.2).
 *
 * ## Three controls, and one of them is sometimes absent
 *
 * With **one** profile the row does not open and the trash is not drawn. Not disabled:
 * the last profile cannot be deleted (backend `0049` section 1.3), and a control you
 * may not use is a control somebody works out the reason for. The plus is always there,
 * because minting the second profile is exactly what makes the other two meaningful.
 *
 * ## Rule R1, and why it is in the CSS rather than in a `slice`
 *
 * A profile name renders on one line with an ellipsis, here and in the open list and in
 * `0045`'s sheet, and **the layout never grows to fit it**: the name is the only thing
 * that flexes, the plus and the trash keep their 44px whatever it says. Truncating the
 * string in TypeScript would truncate the accessible name with it, which is the one
 * thing R1 forbids: a screen reader is handed the whole name and only the drawing is
 * short. That is what `aria-label` on the button is for, and why it is not the visible
 * text.
 *
 * ## Rule D1 holds
 *
 * No store, no service, no router. It is told the profiles and says what was pressed;
 * the page owns what any of that means.
 */
@Component({
  selector: 'lib-profile-selector',
  imports: [RokuTranslatorPipe, ChevronDownIcon, PlusIcon, TrashIcon],
  templateUrl: './profile-selector.html',
  styleUrl: './profile-selector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileSelector {
  readonly profiles = input.required<readonly ShoppingProfile[]>();
  readonly selectedId = input.required<string | null>();

  /**
   * What an unnamed profile is called, already translated.
   *
   * Passed in rather than resolved here, because the same string is the name field's
   * placeholder and the page's own live announcements, and two components translating
   * the same key is two places for it to be the wrong key.
   */
  readonly defaultName = input.required<string>();

  readonly select = output<string>();
  readonly add = output<void>();
  readonly remove = output<void>();

  protected readonly open = signal(false);

  /** The profile on the row, or null before anything has loaded. */
  protected readonly current = computed<ShoppingProfile | null>(() => {
    const profiles = this.profiles();
    const id = this.selectedId();
    return (
      profiles.find((profile) => profile.id === id) ??
      profiles.find((profile) => profile.isDefault) ??
      profiles[0] ??
      null
    );
  });

  /** The full name, which is the accessible name even when the drawing is short. */
  protected readonly currentName = computed(() => this.nameOf(this.current()));

  /** Whether there is anything to switch to. One profile does not open. */
  protected readonly canOpen = computed(() => this.profiles().length > 1);

  /** The last profile offers no trash at all. See the class comment. */
  protected readonly canRemove = this.canOpen;

  /** A profile's name, or the localized default when it has never been named. */
  protected nameOf(profile: ShoppingProfile | null): string {
    const name = profile?.name ?? null;
    return name === null || name.trim() === '' ? this.defaultName() : name;
  }

  protected toggle(): void {
    if (this.canOpen()) {
      this.open.update((was) => !was);
    }
  }

  protected choose(profileId: string): void {
    this.open.set(false);
    this.select.emit(profileId);
  }

  /** Escape closes the list, which is the one exit a listbox owes the keyboard. */
  protected close(): void {
    this.open.set(false);
  }
}
