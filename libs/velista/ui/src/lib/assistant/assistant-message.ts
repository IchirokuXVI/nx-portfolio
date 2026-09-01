import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronRightIcon } from '../icons/icons';

/**
 * The one link under a reply, ready to render.
 *
 * The **container** turns an `AssistantListLink` into this, because building the URL
 * needs the locale and the mount and rule D1 keeps both out of here. What arrives is a
 * path, the list's name, and the zone's name when the server said it was worth saying.
 *
 * There is no `kind` and no query parameter, because there is one kind and a list
 * needs neither (plan 0042, section 3.1).
 */
export interface AssistantLinkVm {
  readonly label: string;
  readonly path: string;
  readonly zoneLabel: string | null;
}

/** One tappable answer to the question this message asked. */
export interface AssistantChoiceVm {
  readonly label: string;
  readonly message: string;
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
  /** Where this reply offers to go, and absent when it offers nowhere. */
  readonly link?: AssistantLinkVm;
  /**
   * The answers on offer, empty unless this is the **last** message and it asked
   * something. The container applies that rule (plan 0042, section 4.3).
   */
  readonly choices: readonly AssistantChoiceVm[];
  /** Seconds still to wait, already counted down by the container. */
  readonly waitSeconds?: number;
  /**
   * The bubble's own id, so the chip group can be labelled by the question above it.
   *
   * Absent for a reply the panel wrote itself, which has no question to point at; the
   * group falls back to a key of its own.
   */
  readonly bubbleId?: string;
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
 * ## One link, and it goes to a list
 *
 * It came from a tool result in the same turn (backend rule A3), so the target exists
 * and the caller can see it. An id parsed out of the prose would have neither property,
 * and a link to a list that was never there is worse than no link at all.
 *
 * It is a **line of text** and not a chip (plan 0042, section 3.2). A row of chips, one
 * per thing the turn touched, was a bill of materials: two of them opened the same
 * screen, and what somebody wants after "there is no milk on the weekly shop" is to go
 * to the weekly shop.
 *
 * ## The chips got a better job
 *
 * When the turn ended by asking which list, the answers to that question sit under it
 * and tapping one answers it. They are `<button>`s and not links, because tapping one
 * **says something** rather than going anywhere, and the container sends it down the
 * same path a typed message takes.
 */
@Component({
  selector: 'lib-assistant-message',
  imports: [RokuTranslatorPipe, RouterLink, ChevronRightIcon],
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

  /**
   * An answer somebody tapped, as the sentence it stands for.
   *
   * The `message` and not the `label`: what leaves this app is what the person said,
   * and the chip's short text is only how it was offered.
   */
  readonly chose = output<string>();
}
