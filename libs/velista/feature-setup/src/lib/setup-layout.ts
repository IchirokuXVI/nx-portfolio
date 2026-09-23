import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ProfileStore } from '@portfolio/velista/data-access';
import { SetupFlow } from './setup-flow';

/**
 * The parent of the setup's five screens (velista `0098`, section 2).
 *
 * ## Why it provides the flow
 *
 * The five screens are one task, and `SetupFlow` is that task's state. Provided here,
 * it lives exactly as long as somebody is inside the setup and no longer.
 *
 * ## Why leaving marks the setup as over
 *
 * Section 7 lists the exits: Not now, No thank you, Show me around, and the back
 * chevron out of the setup. The first three are buttons and call the mark themselves.
 * The fourth is not one control: it is the browser's back, the phone's back gesture, or
 * the chevron on the name step popping past the welcome. What they share is that this
 * component is destroyed, so the mark is here, where every one of them arrives.
 *
 * Reloading or closing the app does not destroy it, which is what section 7 wants:
 * the answers given so far are already written, and the setup is offered again once.
 *
 * A component and not a route provider's `DestroyRef`, because a route's providers are
 * never destroyed and a component is.
 */
@Component({
  selector: 'lib-setup-layout',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-block-size: 100%;
    }
  `,
  providers: [SetupFlow],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupLayout {
  constructor() {
    const profile = inject(ProfileStore);

    // A second call after a button already marked it sends nothing: the store sends
    // the stamp at most once per document.
    inject(DestroyRef).onDestroy(() => profile.completeSetup());
  }
}
