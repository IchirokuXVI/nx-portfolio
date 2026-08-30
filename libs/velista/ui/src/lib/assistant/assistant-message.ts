import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CheckOutlineIcon, ListLinesIcon, PersonIcon } from '../icons/icons';

/**
 * A link under a reply, ready to render.
 *
 * The **container** turns an `AssistantReference` into this, because building the URL
 * needs the locale and the mount and rule D1 keeps both out of here. What arrives is a
 * path and, for a line, the query parameter that addresses it.
 */
export interface AssistantLinkVm {
  readonly kind: 'zone' | 'list' | 'line';
  readonly label: string;
  readonly path: string;
  readonly queryParams?: Readonly<Record<string, string>>;
}

/** One turn, as the transcript renders it. */
export interface AssistantMessageVm {
  readonly speaker: 'caller' | 'bot';
  readonly text: string;
  readonly kind:
    | 'said'
    | 'pending'
    | 'spoken'
    | 'failed'
    | 'throttled'
    | 'unconfigured'
    | 'tooLong'
    | 'badFormat'
    | 'dropped';
  readonly links: readonly AssistantLinkVm[];
  /** Seconds still to wait, already counted down by the container. */
  readonly waitSeconds?: number;
}

/**
 * One message in the column.
 *
 * ## Everything is a message, including what went wrong
 *
 * A transport failure and a busy provider are bubbles here, not banners over the panel
 * (plan 0032, section 3). One kind of thing, in one place, whatever happened: somebody
 * reading down the column sees the answer that did not come where the answer would have
 * been, rather than having to look somewhere else for it.
 *
 * ## The text is text
 *
 * Interpolated, never `innerHTML`, and **never rendered as markdown**. The model writes
 * free prose (backend `0039` section 7) and is told the client draws the links itself,
 * so a sentence that happens to contain something link shaped is a sentence. Selectable,
 * because a shopping answer is a thing people copy.
 *
 * ## The links are the references, and only the references
 *
 * Every one came from a tool result in the same turn (backend rule A3), so the target
 * exists and the caller can see it. An id parsed out of the prose would have neither
 * property, and a link to a list that was never there is worse than no link at all.
 */
@Component({
  selector: 'lib-assistant-message',
  imports: [
    RokuTranslatorPipe,
    RouterLink,
    CheckOutlineIcon,
    ListLinesIcon,
    PersonIcon,
  ],
  templateUrl: './assistant-message.html',
  styleUrl: './assistant-message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'message().speaker',
    '[class.notice]': 'message().kind === "dropped"',
  },
})
export class AssistantMessage {
  readonly message = input.required<AssistantMessageVm>();
}
