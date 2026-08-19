import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

/**
 * A titled slice of a project detail page: a heading plus an always-visible
 * `[lead]` (the highlight) and an optional `[deep]` block that only renders
 * when `open` is on. The page keeps a single `deepDive` toggle and passes it
 * down to every section, so the whole in-depth layer reveals at once (see
 * 0007). Project agnostic: odontogram and damocles reuse it as their case
 * studies land.
 *
 * `sectionId` becomes the element `id`, so a `detail-toc` can anchor to it and
 * an IntersectionObserver can track which section is in view.
 */
@Component({
  selector: 'lib-landing-v2-detail-section',
  imports: [],
  templateUrl: './detail-section.html',
  styleUrl: './detail-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailSection {
  sectionId = input.required<string>();
  heading = input.required<string>();

  /** When false only the lead shows; the page-level deep-dive toggle flips
   * this on to reveal the deeper block. */
  open = input(false, { transform: booleanAttribute });
}
