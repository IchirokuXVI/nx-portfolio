import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ResourceCell } from '@portfolio/luna-shopper-admin/models';

/**
 * One value, drawn.
 *
 * The whole of the cell's judgement happened in `toCell`, which is a pure
 * function with a spec. What is left here is the one thing a pure function
 * cannot do: translate. A cell that carries a key is a value that is a word,
 * such as yes, no, an enum's label or the fact that there is nothing there, and
 * hard coding any of those in English would put the app's only untranslated
 * string in its most repeated element.
 */
@Component({
  selector: 'lib-resource-cell',
  imports: [RokuTranslatorPipe],
  template: `
    @if (cell().key; as key) {
      <span class="word">{{ key | rokuT }}</span>
    } @else if (cell().href; as href) {
      <!-- rel="noopener" on every outbound link: these are supermarket
           websites, and the tab one opens must not be able to reach back into
           an admin session. -->
      <a [href]="href" rel="noopener noreferrer" target="_blank">{{
        cell().text
      }}</a>
    } @else {
      {{ cell().text }}
    }
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }

    .word {
      color: var(--admin-ink-muted);
    }

    a {
      color: var(--admin-accent);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceCellView {
  readonly cell = input.required<ResourceCell>();
}
