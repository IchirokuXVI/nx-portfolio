import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatedInfoFact } from '@portfolio/landing-v2/models';

/**
 * Renders the hero's "facts" table entirely from the `facts` input (brief
 * #2) — no hardcoded rows. Empty state renders nothing, not an empty shell.
 */
@Component({
  selector: 'lib-landing-v2-info-table',
  imports: [],
  templateUrl: './info-table.html',
  styleUrl: './info-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoTable {
  facts = input<TranslatedInfoFact[]>([]);
}
