import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One chain as the setup's last step draws it. */
export interface SetupChainRow {
  readonly supermarketId: string;
  /** Already in the reader's language. */
  readonly name: string;
  /** Shops near the code, or null when there is no code and so nothing to count. */
  readonly shops: number | null;
  readonly on: boolean;
}

/**
 * The chains the setup offers, each one a switch (velista `0098`, section 5, step 3).
 *
 * **A chain switched off stays on the list**, drawn the way the profiles page draws an
 * excluded chain: struck through, dimmed, and marked with the word. Three signals, so
 * taking away the colour takes away nothing. It is a decision, not a deletion, and the
 * row is where it is undone.
 *
 * The whole row is the target, because a `<label>` around the checkbox makes it one.
 */
@Component({
  selector: 'lib-setup-chain-list',
  imports: [RokuTranslatorPipe],
  template: `
    <div [attr.aria-labelledby]="labelledBy()" class="card" role="group">
      @for (row of rows(); track row.supermarketId) {
        <label [class.off]="!row.on" class="row">
          <span aria-hidden="true" class="tile">{{ initial(row.name) }}</span>
          <span class="text">
            <span class="name">{{ row.name }}</span>
            @if (row.shops !== null) {
              <span class="count">
                {{ 'setup.shops.count' | rokuT: { count: row.shops } }}
              </span>
            }
          </span>
          @if (!row.on) {
            <span class="mark">{{ 'setup.shops.off' | rokuT }}</span>
          }
          <input
            (change)="switched.emit(row.supermarketId)"
            [checked]="row.on"
            class="checkbox"
            type="checkbox"
          />
        </label>
      }
    </div>
  `,
  styleUrl: './setup-chain-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupChainList {
  readonly rows = input.required<readonly SetupChainRow[]>();

  /** The id of the heading that names the group. */
  readonly labelledBy = input<string | null>(null);

  /** A chain's id, each time its switch is pressed. */
  readonly switched = output<string>();

  /** The tile's letter. Decorative: the name beside it is what is read out. */
  protected initial(name: string): string {
    return name.trim().charAt(0).toLocaleUpperCase();
  }
}
