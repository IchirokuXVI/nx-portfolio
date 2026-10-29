import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A sentence cut around its one link. */
export interface LinkedParts {
  readonly before: string;
  /** The words of the link, or null when the sentence names none. */
  readonly link: string | null;
  readonly after: string;
}

/**
 * Cut a translated sentence at its one bracketed link: "I accept the [Terms]" becomes
 * "I accept the ", "Terms" and "" (velista `0173`).
 *
 * The brackets are in the translation files so each language puts the link where its
 * own word order wants it. A sentence with no pair, or a broken one, is all text: a
 * sentence is never drawn with a stray bracket or a link nobody can read.
 */
export function linkedParts(text: string): LinkedParts {
  const open = text.indexOf('[');
  const close = open === -1 ? -1 : text.indexOf(']', open + 1);
  if (open === -1 || close === -1 || close === open + 1) {
    return { before: text, link: null, after: '' };
  }

  return {
    before: text.slice(0, open),
    link: text.slice(open + 1, close),
    after: text.slice(close + 1),
  };
}

/**
 * A sentence with one link inside it, drawn as text with no injected HTML
 * (velista `0173`).
 *
 * The lines about the terms all have this shape: the Google line, the guest notice, the
 * privacy line, the refusals and the prompt. The container builds the address with
 * `appPath`; this knows neither the locale nor the mount, and inherits the colour and
 * size of where it is drawn. The link is the app's quiet accent and underlined, so it
 * reads as a link in running text without colour alone.
 */
@Component({
  selector: 'lib-linked-text',
  imports: [RouterLink],
  // Written on as few lines as the parts allow, and kept that way: a line break
  // between the text and the link would draw a space before a full stop.
  // prettier-ignore
  template: `@let parts = cut(text());{{ parts.before }}@if (parts.link !== null) {@if (href(); as url) {<a [queryParamsHandling]="keepQuery() ? 'preserve' : null" [routerLink]="url" class="link">{{ parts.link }}</a>} @else {{{ parts.link }}}}{{ parts.after }}`,
  styleUrl: './linked-text.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkedText {
  /** The translated sentence, with its link in brackets. */
  readonly text = input.required<string>();

  /**
   * Where the link goes, built with `appPath` by the container. Null while the address
   * is unknown (the settings are not read yet, or the read failed): the bracketed
   * words are then drawn as plain text, never as brackets and never as a link to
   * nowhere.
   */
  readonly href = input.required<string | null>();

  /**
   * Whether the link keeps the page's query, as a sheet over a form does so its fallback
   * on a cold load returns to the same form.
   */
  readonly keepQuery = input(false);

  protected readonly cut = linkedParts;
}
