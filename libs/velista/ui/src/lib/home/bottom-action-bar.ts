import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BasketIcon, JoinCodeIcon } from '../icons/icons';

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
 * ## The primary action finally does the thing it is named after
 *
 * **Get shopping list** composes a basket from everything still needed in the lists the
 * person chooses. It spent `0019` answering a tap with a **Coming soon** line, because
 * the feature behind it was parked; plan 0045 built it, so the line is gone and so is
 * the state that held it. What is left is an ordinary button that opens the generation
 * sheet.
 *
 * **It is enabled for everybody, and that is a decision rather than an oversight.** A
 * run needs `WRITE` on its sources (backend `0051` section 2), so somebody who can
 * write nowhere cannot generate anything. They find that out **inside the sheet**,
 * where the source list is empty and says what is needed, rather than by pressing a
 * dead button on the dashboard and being told nothing. `0019` section 4 allowed the
 * disabled treatment as a temporary exception and said so; this ends it.
 *
 * `LineComposer`'s rule, that a control somebody is not permitted to use is absent
 * rather than disabled, is about permission on a known object and still holds. Whether
 * a person can generate is not knowable here without a request, and the honest place to
 * answer it is the screen that lists the sources.
 *
 * It replaced **New list**, which was never an action this screen could offer: a list
 * belongs to a zone, and the dashboard is the one screen with no zone in scope. The
 * group page already offers New list with the zone already chosen (plan 0019,
 * section 4).
 *
 * ## It is also the shell every bottom bar in the app is
 *
 * The shopping list history ended in a bar of its own that looked like this one and was
 * measured differently: a 20px block end against this one's 16px, and no ground at all,
 * so the two screens one tap apart were different colours (plan 0061, section 1). Two
 * files that have to keep agreeing had already failed to.
 *
 * So the bar is one thing now. What it is, is a shell: a top rule, a ground, the safe
 * area inset and one row of actions. `ng-content` takes that row, and the dashboard's
 * own pair is the fallback, which is why the home page's call site is unchanged and its
 * two outputs still work exactly as they did.
 *
 * **It places nothing.** No `position`, no `flex` on the host: it is a block, and the
 * parent decides where the block goes. The history page is a flex column whose middle
 * scrolls and whose bar does not, and a `position: fixed` in here would break that one
 * screen while leaving the one being edited looking right (section 1.3).
 */
@Component({
  selector: 'lib-bottom-action-bar',
  imports: [RokuTranslatorPipe, BasketIcon, JoinCodeIcon],
  template: `
    <div class="bar">
      <!--
        The dashboard's pair is the fallback rather than a projected default, so nothing
        about home's call site changes and its outputs keep firing whether or not a
        caller projects a row of its own.
      -->
      <ng-content>
        <button (click)="getList.emit()" class="primary" type="button">
          <lib-basket-icon class="glyph" />
          {{ 'home.action.generateList' | rokuT }}
        </button>

        <button
          (click)="joinZone.emit()"
          [attr.aria-label]="'home.action.joinCode' | rokuT"
          class="secondary"
          type="button"
        >
          <lib-join-code-icon class="glyph" />
        </button>
      </ng-content>
    </div>
  `,
  styleUrl: './bottom-action-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomActionBar {
  /** Open the generation sheet. The container owns the route (plan 0045, section 4). */
  readonly getList = output<void>();

  readonly joinZone = output<void>();
}
