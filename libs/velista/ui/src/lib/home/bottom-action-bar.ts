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
 */
@Component({
  selector: 'lib-bottom-action-bar',
  imports: [RokuTranslatorPipe, PlusIcon, JoinCodeIcon],
  template: `
    <div class="bar">
      <button (click)="newList.emit()" class="primary" type="button">
        <lib-plus-icon class="glyph" />
        {{ 'home.action.newList' | rokuT }}
      </button>

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
  readonly newList = output<void>();
  readonly joinZone = output<void>();
}
