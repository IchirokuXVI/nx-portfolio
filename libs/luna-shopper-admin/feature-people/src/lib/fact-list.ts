import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { RecordId } from '@portfolio/luna-shopper-admin/ui';
import { PEOPLE_STYLES } from './people-styles';

/** One line of a list of facts: a keyed label, and a value already formatted. */
export interface Fact {
  /** A translation key. */
  readonly label: string;
  /** Already formatted. Empty renders as "none". */
  readonly text: string;
  /** Where the value leads, when it names a row with a page of its own. */
  readonly link?: readonly string[] | null;
  /** Whether the value is copied character by character: an id, a code. */
  readonly mono?: boolean;
  /**
   * Whether the value is the row's own ID (admin plan 0051, section 4). It is
   * then drawn small, with a button that copies it, and never as a link.
   */
  readonly id?: boolean;
}

/**
 * A list of facts, from values that are already strings.
 *
 * A component of its own because the pages of a person, a zone, a list and a
 * shopping list each draw one, and because a list of facts is the thing worth
 * asserting on without rendering: a spec reads the array.
 */
@Component({
  selector: 'lib-fact-list',
  imports: [RouterLink, RokuTranslatorPipe, RecordId],
  template: `
    <dl class="facts">
      @for (fact of facts(); track $index) {
        <div class="fact">
          <dt>{{ fact.label | rokuT }}</dt>
          <dd [class.mono]="fact.mono === true">
            @if (fact.text === '') {
              <span class="muted">{{ 'resource.value.none' | rokuT }}</span>
            } @else if (fact.id === true) {
              <lib-record-id [value]="fact.text" />
            } @else if (fact.link; as link) {
              <a [routerLink]="link" class="link">{{ fact.text }}</a>
            } @else {
              {{ fact.text }}
            }
          </dd>
        </div>
      }
    </dl>
  `,
  styles: [
    PEOPLE_STYLES,
    `
      :host {
        display: block;
        flex: none;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FactList {
  readonly facts = input.required<readonly Fact[]>();
}
