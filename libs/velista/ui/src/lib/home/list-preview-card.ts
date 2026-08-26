import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { PreviewLineVm } from '@portfolio/velista/models';
import { CheckCircleIcon, CircleIcon, XCircleIcon } from '../icons/icons';

/**
 * The illustrative list on the anonymous screen.
 *
 * **Not real data**, and it never becomes real data: it exists to show what the
 * product is in one glance, which is a job a screenshot would also do except that this
 * one is themed, translated and legible at 200% zoom.
 *
 * It shows all three line states on purpose, because "some of these are done and
 * somebody else did them" is the whole idea of the product and is hard to say in a
 * sentence.
 */
@Component({
  selector: 'lib-list-preview-card',
  imports: [RokuTranslatorPipe, CheckCircleIcon, CircleIcon, XCircleIcon],
  templateUrl: './list-preview-card.html',
  styleUrl: './list-preview-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPreviewCard {
  readonly listName = input.required<string>();
  readonly zoneName = input.required<string>();
  readonly lines = input.required<readonly PreviewLineVm[]>();
  readonly shoppingNow = input(0);
}
