import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * A titled slice of a project detail page: a heading plus an ordered list of
 * paragraphs. Paragraph-list driven (0008) rather than content-projected, so
 * the page can hand it either the short highlight paragraphs or the longer
 * deep-dive set for the same section by swapping the key list. Project
 * agnostic; odontogram and damocles reuse it as their case studies land.
 *
 * `sectionId` becomes the element `id`, so a `detail-toc` can anchor to it and
 * an IntersectionObserver can track which section is in view.
 */
@Component({
  selector: 'lib-landing-v2-detail-section',
  imports: [RokuTranslatorPipe],
  templateUrl: './detail-section.html',
  styleUrl: './detail-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailSection {
  sectionId = input.required<string>();
  heading = input.required<string>();

  /** Ordered i18n keys, one per paragraph, resolved in the template so the
   * section re-translates on a runtime locale switch. */
  paragraphKeys = input.required<readonly string[]>();
}
