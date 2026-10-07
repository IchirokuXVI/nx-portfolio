import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { AddTargetList } from '@portfolio/velista/models';

/** One group's lists, under the group's name. */
interface ListChoiceGroup {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly lists: readonly AddTargetList[];
}

/**
 * Which list does the plus add to? (velista `0134`, section 4.3)
 *
 * Every list the person can write to, under the name of its group, with a radio
 * mark on the chosen one and how many lines it still wants. **A press chooses**,
 * and the container closes the sheet: there is no second step to confirm.
 *
 * Not `ListPicker`. That one is a popover over a field that asks at every add and
 * remembers nothing. This one is asked once, shows which list is chosen now, and
 * the answer stays until it is changed.
 *
 * A list the person only reads is not here. The container filters them out.
 */
@Component({
  selector: 'lib-list-choice',
  imports: [RokuTranslatorPipe],
  template: `
    <div [attr.aria-labelledby]="labelledBy()" class="groups" role="radiogroup">
      @for (group of groups(); track group.zoneId) {
        <p class="group">{{ group.zoneName }}</p>
        @for (list of group.lists; track list.listId) {
          <button
            (click)="chosen.emit(list.listId)"
            [attr.aria-checked]="list.listId === selectedId()"
            [attr.data-list]="list.listId"
            [class.is-on]="list.listId === selectedId()"
            class="option"
            role="radio"
            type="button"
          >
            <span aria-hidden="true" class="radio"></span>
            <span class="text">
              <span class="name">{{ list.name }}</span>
              <span class="caption">{{
                'catalog.lists.toBuy' | rokuT: { count: list.wanted }
              }}</span>
            </span>
          </button>
        }
      }
    </div>
  `,
  styleUrl: './list-choice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListChoice {
  /** The lists on offer, in the order their groups are drawn. */
  readonly lists = input.required<readonly AddTargetList[]>();
  readonly selectedId = input<string | null>(null);
  /** The id of the sheet's title, which names the group of radios. */
  readonly labelledBy = input.required<string>();

  readonly chosen = output<string>();

  protected readonly groups = computed<readonly ListChoiceGroup[]>(() => {
    const groups = new Map<
      string,
      { zoneName: string; lists: AddTargetList[] }
    >();
    for (const list of this.lists()) {
      const held = groups.get(list.zoneId);
      if (held === undefined) {
        groups.set(list.zoneId, { zoneName: list.zoneName, lists: [list] });
      } else {
        held.lists.push(list);
      }
    }
    return [...groups].map(([zoneId, group]) => ({ zoneId, ...group }));
  });
}
