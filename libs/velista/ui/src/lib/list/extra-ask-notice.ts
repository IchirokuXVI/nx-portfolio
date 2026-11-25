import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * What a "Count the extra" that wrote nothing says, in the question's place
 * (velista `0208`, target state 4): the same anchored frame, its pointer on the
 * control, one sentence and no buttons. The page says it in its polite region as
 * well, since this takes no focus, and takes it down on the next touch anywhere,
 * on Escape and on leaving.
 */
@Component({
  selector: 'lib-extra-ask-notice',
  template: `<p class="notice">{{ words() }}</p>`,
  styles: `
    :host {
      display: block;
    }

    .notice {
      margin: 0;
      padding: 0 var(--app-space-5) var(--app-space-4);
      color: var(--app-text-primary);
      font-size: var(--app-add-choice-title);
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtraAskNotice {
  /** The sentence, already in the page's language. */
  readonly words = input.required<string>();
}
