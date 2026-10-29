import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LegalSectionView } from '../render';

/**
 * The sections of a filled document: headings, paragraphs, lists and the table as one
 * block per row (velista `0172`, target 5).
 *
 * One component for the page and the sheet of velista `0173`, so a document reads the
 * same wherever it is opened. Every text is bound with interpolation only: there is no
 * `innerHTML` in this library.
 *
 * Each heading carries `data-section` and an id, which the page's contents scroll to.
 * `idPrefix` keeps the ids of a sheet apart from the page's, should both ever be drawn.
 */
@Component({
  selector: 'lib-legal-sections',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, RouterLink],
  templateUrl: './legal-sections.html',
  styleUrl: './legal-sections.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalSections {
  readonly sections = input.required<readonly LegalSectionView[]>();

  /** The start of each heading's id. */
  readonly idPrefix = input('legal-');

  /**
   * Whether a link to the other document keeps the page's query, as a sheet over a
   * form does, so the form underneath keeps its own.
   */
  readonly keepQuery = input(false);
}
