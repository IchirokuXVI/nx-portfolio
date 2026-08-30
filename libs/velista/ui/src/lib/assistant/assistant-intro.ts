import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * What is on screen before anybody has said anything (plan 0032, section 3).
 *
 * **Three sentences, and they are the three tools.** A text box with a cursor in it
 * tells nobody what to type, and this bot can do exactly three things (backend `0039`
 * section 6), so the empty state is those three written as somebody would actually say
 * them rather than as a feature list.
 *
 * They are **examples and not buttons**. Tapping one would put words in somebody's
 * mouth and, worse, would teach that the panel takes commands from a menu, which is
 * the opposite of the thing being tested. Whoever reads them types or speaks their own
 * version.
 */
@Component({
  selector: 'lib-assistant-intro',
  imports: [RokuTranslatorPipe],
  template: `
    <p class="lead">{{ 'assistant.intro.lead' | rokuT }}</p>

    <ul class="examples">
      @for (example of examples; track example) {
        <li class="example">
          <span class="label">{{
            'assistant.intro.' + example + '.label' | rokuT
          }}</span>
          <span class="said">{{
            'assistant.intro.' + example + '.said' | rokuT
          }}</span>
        </li>
      }
    </ul>
  `,
  styleUrl: './assistant-intro.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantIntro {
  /** In the order the tools are worth discovering: add, ask, then the account one. */
  protected readonly examples = ['add', 'ask', 'rename'] as const;
}
