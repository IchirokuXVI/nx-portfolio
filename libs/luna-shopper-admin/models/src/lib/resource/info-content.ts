/**
 * What an info button says about a page or a part of one (admin plan 0041,
 * section 3).
 *
 * How to use the thing in front of the operator: what a row is, what the main
 * action does, where the result goes. Never why the gateway has or lacks a
 * route, and never how the data is stored.
 *
 * Every member is a translation key. The limits are part of the meaning, and
 * `info-content.spec.ts` in `ui` holds the catalogue to them: at most four
 * points, at most 25 words in each, and at most one caution.
 */
export interface InfoContent {
  /** The subject, as the heading of the panel and the name of the button. */
  readonly title: string;
  /** At most four sentences, each one thing the operator can do or read. */
  readonly points: readonly string[];
  /**
   * An effect that is large or cannot be taken back.
   *
   * Here only when the action it warns about is not on a form. A form's caution
   * is `ResourceDescriptor.caution`, which stays visible beside the action.
   */
  readonly caution?: string;
}

/**
 * How specific a price scope is, as the mark beside its name draws it: one bar
 * for nationwide, up to four for a single shop.
 */
export type ScopeLevel = 1 | 2 | 3 | 4;

/** The scope mark of one cell: how many bars are filled, and what to call it. */
export interface ScopeMarkView {
  readonly level: ScopeLevel;
  /** A translation key for the kind, which is the mark's accessible name. */
  readonly label: string;
}
