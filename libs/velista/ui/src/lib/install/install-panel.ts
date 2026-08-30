import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { InstallGuide, InstallState } from '@portfolio/velista/platform';
import { CheckCircleIcon, ChevronDownIcon, InstallIcon } from '../icons/icons';
import { InstallSteps } from './install-steps';

/**
 * The primary slot of the install page: the button, the steps, or the confirmation.
 *
 * ## The steps are the floor and the button is the improvement (D3)
 *
 * `manual` is the state this starts in and the state it stays in on Safari, on Firefox
 * and on any browser that never fires `beforeinstallprompt`, so the steps are what
 * renders from the first frame. When a prompt arrives the button takes the top of the
 * slot and the steps **fold**, on this same page, behind a disclosure. They are never
 * removed and never moved to a second screen: putting a navigation between somebody and
 * the only method their browser has is the thing this design exists to avoid.
 *
 * The inverse, a button that falls back to instructions, cannot be built. It would have
 * to decide which of the two to draw before the browser has said anything, and it would
 * be wrong on Safari every time (section 2.1).
 *
 * ## Nothing here waits (D4)
 *
 * There is no spinner, no skeleton and no `aria-busy` anywhere in this component,
 * because nothing is loading: the state is what the browser has said so far, and a page
 * rendered before the event arrives is early rather than wrong. The slot is occupied
 * from the first frame, so the improvement happens above the reader rather than under
 * them. Saying so out loud is the container's job, through the live region it owns.
 *
 * ## The disclosure is a disclosure
 *
 * A downward caret and `aria-expanded`, never a link and never a navigation. Same
 * control in the `installed` state, where the same steps unfold under the same
 * confirmation, because installedness is a belief with no uninstall event behind it and
 * no state of this screen may be a dead end (rule I4).
 *
 * Rule D1 holds: no store, no service, no router. The state arrives as an input and
 * `install` leaves as an output.
 */
@Component({
  selector: 'lib-install-panel',
  imports: [
    RokuTranslatorPipe,
    CheckCircleIcon,
    ChevronDownIcon,
    InstallIcon,
    InstallSteps,
  ],
  templateUrl: './install-panel.html',
  styleUrl: './install-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallPanel {
  readonly state = input.required<InstallState>();
  readonly guide = input.required<InstallGuide>();

  /** Pressed. The container calls `InstallStore.prompt()`, which this may not reach. */
  readonly install = output<void>();

  /**
   * Whether the reader has unfolded the steps.
   *
   * Only consulted in the two states that fold them. In `manual` the steps are the
   * content of the slot and there is nothing to unfold, which is why the template
   * branches on the state rather than on this.
   */
  protected readonly revealed = signal(false);

  /** Whether the steps are behind a disclosure rather than being the slot itself. */
  protected readonly folded = computed(() => this.state() !== 'manual');

  /**
   * The disclosure's own words, which differ by what the reader is being offered.
   *
   * Under a button it is an alternative; under the confirmation it is a repair for a
   * belief that may be wrong. Neither says *you already have this*.
   */
  protected readonly revealKey = computed(() =>
    this.state() === 'installed'
      ? 'install.installed.reveal'
      : 'install.manual.reveal'
  );

  protected toggle(): void {
    this.revealed.update((open) => !open);
  }
}
