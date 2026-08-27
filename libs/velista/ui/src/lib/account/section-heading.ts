import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The small capitalised label above a group of rows.
 *
 * A component rather than a class on an `<h2>` because it carries two things a class
 * cannot: the element is a real heading, so a screen reader user can navigate by it,
 * and it takes an `id` so the `<section>` around the rows can be labelled by it. A
 * `<div class="section-title">` gives neither, and both member pages in this app
 * already prove how easy that is to forget.
 *
 * The key, not the string. Nothing in `ui` renders a sentence its caller resolved,
 * which is what keeps a page from assembling copy out of fragments.
 */
@Component({
  selector: 'lib-section-heading',
  imports: [RokuTranslatorPipe],
  template: `<h2 [id]="headingId()" class="heading">{{ key() | rokuT }}</h2>`,
  styleUrl: './section-heading.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeading {
  readonly key = input.required<string>();

  /** So the section this heads can name itself with `aria-labelledby`. */
  readonly headingId = input.required<string>();
}
