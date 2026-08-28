import { ChangeDetectionStrategy, Component, output } from '@angular/core';
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
 * ## The primary action is disabled, and that is deliberate
 *
 * `LineComposer` states the opposite rule for itself: a control somebody is **not
 * permitted** to use is absent, never disabled, because a dead invitation costs a tap
 * to find out. The two are not in conflict, and the difference is worth naming because
 * the next person to read them together will assume one of them is wrong.
 *
 * That rule is about permission. This is about a feature that does not exist yet for
 * anybody: **Get shopping list**, a run assembled across every zone and list the user
 * chose. It is designed and parked in the backend's
 * `plans/backlog/0003-generated-shopping-lists.md`, and nothing behind it is built
 * here. Removing the button would leave the primary slot of the primary screen empty
 * and would tell a returning user nothing about where the product is going.
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
        The disabled binding is hard coded and not an input: an input would invite a
        caller to pass false and enable a button with nothing behind it. The reason is
        on-screen text rather than a tooltip, and aria-describedby points at it, so
        both a reader and a screen reader are told why, rather than meeting a bare
        disabled control. (No backticks in here: this is a template literal.)
      -->
      <div class="primary-slot">
        <button
          [attr.aria-describedby]="soonId"
          [disabled]="true"
          class="primary"
          type="button"
        >
          <lib-plus-icon class="glyph" />
          {{ 'home.action.generateList' | rokuT }}
        </button>

        <span [id]="soonId" class="soon">{{
          'home.action.generateListSoon' | rokuT
        }}</span>
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
   * The id `aria-describedby` points at.
   *
   * The bar is rendered once per page, so a constant is enough and a generated id
   * would only make the markup harder to read in a test.
   */
  readonly soonId = 'home-generate-list-soon';
}
