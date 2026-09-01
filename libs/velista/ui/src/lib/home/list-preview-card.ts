import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { PreviewLineVm } from '@portfolio/velista/models';
import { CheckIcon, XCircleIcon } from '../icons/icons';

/**
 * The illustrative list on the anonymous screen.
 *
 * **Not real data**, and it never becomes real data: it exists to show what the
 * product is in one glance, which is a job a screenshot would also do except that this
 * one is themed, translated and legible at 200% zoom.
 *
 * It shows a bought line, a wanted one and one the shop did not have, because "some
 * of these are dealt with and somebody else dealt with them" is the whole idea of the
 * product and is hard to say in a sentence.
 *
 * **The quantity is the state here, exactly as it is on the real row** (velista plan
 * 0043). This card used to draw a tick, a circle and a cross, which was a picture of a
 * checkbox the product no longer has; a front door advertising a control that does not
 * exist is worse than no picture at all.
 */
@Component({
  selector: 'lib-list-preview-card',
  imports: [RokuTranslatorPipe, CheckIcon, XCircleIcon],
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
