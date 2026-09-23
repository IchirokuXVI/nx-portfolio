import {
  ChangeDetectionStrategy,
  Component,
  inject,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BrandWordmark } from '@portfolio/velista/ui';
import { focusHeading } from '../focus-heading';
import { SetupFlow } from '../setup-flow';

/** One of the three questions the welcome names, as translation keys. */
interface Question {
  readonly title: string;
  readonly body: string;
}

/**
 * The setup's first screen (velista `0098`, section 4).
 *
 * The only screen that names the whole setup: the three questions as numbered rows,
 * **Start**, and **Not now**.
 *
 * **Not now is final, and the screen does not say so.** It writes the same mark
 * finishing does and goes home. A warning about a permanent choice makes somebody weigh
 * a press that costs them nothing, and nothing is lost by pressing it: the generated
 * name stays, every chain stays on, and each answer has its own row on the account
 * screen.
 *
 * No back chevron: there is no screen of the setup before this one, and the way out is
 * the button that says so.
 */
@Component({
  selector: 'lib-setup-welcome-page',
  imports: [RokuTranslatorPipe, BrandWordmark],
  templateUrl: './welcome-page.html',
  styleUrl: './welcome-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomePage {
  private readonly _flow = inject(SetupFlow);

  protected readonly questions: readonly Question[] = [
    { title: 'setup.welcome.one', body: 'setup.welcome.oneBody' },
    { title: 'setup.welcome.two', body: 'setup.welcome.twoBody' },
    { title: 'setup.welcome.three', body: 'setup.welcome.threeBody' },
  ];

  private readonly _heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    focusHeading(this._heading);
  }

  protected start(): void {
    void this._flow.go('name');
  }

  protected later(): void {
    void this._flow.finish();
  }
}
