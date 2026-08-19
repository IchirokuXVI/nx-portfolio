import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** A single label/value fact. Both are i18n keys resolved in the template, so
 * the table re-translates on a runtime locale switch. */
export interface FactRow {
  labelKey: string;
  valueKey: string;
}

/**
 * A compact facts table for a detail page's meta panel (0007): a `<dl>` of
 * label/value pairs. Key-driven rather than taking pre-translated strings, so
 * the whole thing stays declarative in the template and localizes for free.
 * Presentational and project agnostic; renders nothing with no facts.
 */
@Component({
  selector: 'lib-landing-v2-facts-table',
  imports: [RokuTranslatorPipe],
  templateUrl: './facts-table.html',
  styleUrl: './facts-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FactsTable {
  facts = input<FactRow[]>([]);
}
