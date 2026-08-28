import {
  ChangeDetectionStrategy,
  Component,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { JoinCodeIcon, PlusIcon } from '../icons/icons';

/**
 * The persistent actions on the signed-in screen.
 *
 * Bottom of the screen because the whole app is used one handed, and this is the one
 * place a thumb reaches without shifting grip. Nothing destructive appears here, or
 * anywhere on this page.
 *
 * It clears the home indicator with `env(safe-area-inset-bottom)`, which is the
 * difference between a usable primary action and one that fights the OS gesture bar on
 * every modern phone.
 *
 * ## The primary action answers, and says it is not built yet
 *
 * **Get shopping list** is a run assembled across every zone and list the user chose.
 * It is designed and parked in the backend's
 * `plans/backlog/0003-generated-shopping-lists.md`, and nothing behind it is built
 * here. Removing the button would leave the primary slot of the primary screen empty
 * and would tell a returning user nothing about where the product is going.
 *
 * It used to be `[disabled]="true"` with a permanent **Coming soon** caption beneath
 * it. Both are gone. A caption under the primary action of the primary screen is paid
 * for on every visit, by everybody, to answer a question almost nobody is asking on
 * any given morning, and a disabled control is a dead end that cannot even acknowledge
 * the tap that would ask it. So the button is live, it takes the tap, and it answers
 * it. Whoever wonders finds out, and the visits that were not wondering are not
 * charged for it.
 *
 * `LineComposer` states what looks like the opposite rule: a control somebody is
 * **not permitted** to use is absent, never disabled. That rule is about permission
 * and this is about a feature nobody has yet, so the two do not meet; but they agree
 * on the part that matters, which is that a disabled control is the worst of the
 * shapes available.
 *
 * It replaced **New list**, which was never an action this screen could offer: a list
 * belongs to a zone, and the dashboard is the one screen with no zone in scope. The
 * group page already offers New list with the zone already chosen (plan 0019,
 * section 4).
 */
@Component({
  selector: 'lib-bottom-action-bar',
  imports: [RokuTranslatorPipe, PlusIcon, JoinCodeIcon],
  template: `
    <div class="bar">
      <!--
        The answer is rendered only once it has been asked for, and it is a live
        region so a screen reader hears it: a tap that changes nothing visible is
        indistinguishable from a tap that did not register. aria-describedby is bound
        only while the reason exists, so the button never points at an element that is
        not in the document.
        (No backticks in here: this is a template literal.)
      -->
      <div class="primary-slot">
        <button
          (click)="askedForGenerate()"
          [attr.aria-describedby]="soonShown() ? soonId : null"
          class="primary"
          type="button"
        >
          <lib-plus-icon class="glyph" />
          {{ 'home.action.generateList' | rokuT }}
        </button>

        @if (soonShown()) {
          <span [id]="soonId" aria-live="polite" class="soon" role="status">{{
            'home.action.generateListSoon' | rokuT
          }}</span>
        }
      </div>

      <button
        (click)="joinZone.emit()"
        [attr.aria-label]="'home.action.joinCode' | rokuT"
        class="secondary"
        type="button"
      >
        <lib-join-code-icon class="glyph" />
      </button>
    </div>
  `,
  styleUrl: './bottom-action-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomActionBar {
  readonly joinZone = output<void>();

  /**
   * Whether the tap has been made and the answer is on screen.
   *
   * Held here rather than raised as an output, because nothing outside this component
   * has anything to do about it: there is no navigation, no request and no state that
   * outlives the bar. Rule D1 keeps a presentational component from injecting; it does
   * not require one to be stateless.
   *
   * It does not clear itself on a timer. A message that vanishes is one a slow reader
   * loses to their own eyes, and this one costs a line of muted text under a button
   * that is already there.
   */
  readonly soonShown = signal(false);

  /**
   * The id `aria-describedby` points at.
   *
   * The bar is rendered once per page, so a constant is enough and a generated id
   * would only make the markup harder to read in a test.
   */
  readonly soonId = 'home-generate-list-soon';

  askedForGenerate(): void {
    this.soonShown.set(true);
  }
}
