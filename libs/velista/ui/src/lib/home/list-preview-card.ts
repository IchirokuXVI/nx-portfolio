import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { PreviewLineVm, PreviewTallyVm } from '@portfolio/velista/models';
import { CheckIcon, XCircleIcon } from '../icons/icons';
import { ProductPicture } from '../list/product-picture';

/**
 * The illustrative list on the anonymous screen.
 *
 * **Not real data**, and it never becomes real data: it exists to show what the
 * product is in one glance, which is a job a screenshot would also do except that this
 * one is themed, translated and legible at 200% zoom.
 *
 * Since velista 0175 it is **the zone list in small**: each row looks like a row of the
 * list (`LineRow`) without being one, because `LineRow` is a control and nothing here
 * can be pressed.
 *
 * **It takes the room the page leaves it and gives way row by row.** The host is a size
 * container, and `@container` rules drop the wanted rows first, then the progress line,
 * then the whole card. The progress line is drawn once per step and the same rules show
 * the one that matches the rows on screen. No script measures anything.
 */
@Component({
  selector: 'lib-list-preview-card',
  imports: [RokuTranslatorPipe, CheckIcon, ProductPicture, XCircleIcon],
  templateUrl: './list-preview-card.html',
  styleUrl: './list-preview-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPreviewCard {
  readonly listName = input.required<string>();
  readonly zoneName = input.required<string>();
  readonly lines = input.required<readonly PreviewLineVm[]>();
  /** One per step the rows can give way to, see `PreviewTallyVm`. */
  readonly tallies = input.required<readonly PreviewTallyVm[]>();
  /** The initials of the faces in the head. They stand for names, so never translated. */
  readonly faces = input<readonly string[]>([]);
  /** "Ana and Marc are here", or empty for nobody. */
  readonly presence = input('');
}
