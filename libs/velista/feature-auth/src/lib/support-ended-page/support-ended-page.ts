import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { OutcomeScreen } from '@portfolio/velista/ui';

/**
 * Where a tab lands when its support session is over (velista `0133`, target 7): "End"
 * on the strip, the deadline, or the server refusing the session.
 *
 * One sentence and no link into the app. The tab that draws it is already an ordinary
 * one, because the session left the document behind on its way here, so a link in
 * would open the account of the operator, and that is not what anybody closing a
 * support session is looking for.
 */
@Component({
  selector: 'lib-support-ended-page',
  imports: [OutcomeScreen, RokuTranslatorPipe],
  template: `
    <lib-outcome-screen
      [body]="'support.ended.body' | rokuT"
      [title]="'support.ended.title' | rokuT"
      tone="expired"
    />
  `,
  styles: `
    :host {
      display: block;
      block-size: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportEndedPage {}
