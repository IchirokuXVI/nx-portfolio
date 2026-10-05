/**
 * What the shoppers pages look like, written once (admin plan 0045, section 1).
 *
 * The four detail pages each carried their own copy of the same section, row
 * and button rules, and the fourth had started to disagree with the first. A
 * person, a zone, a list and a shopping list are drawn from these instead: a
 * panel of rows, the states on a row, the buttons, and the three sentences a
 * read can end in.
 *
 * A string and not a stylesheet, because every component here keeps its styles
 * inline. Each one lists this first and its own rules after it.
 */
export const PEOPLE_STYLES = `
  :host {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--admin-space-4);
    min-inline-size: 0;
  }

  h3 {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--admin-ink-muted);
  }

  .panel {
    overflow: hidden;
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius);
    background: var(--admin-surface-raised);
    list-style: none;
  }

  .row {
    display: flex;
    gap: var(--admin-space-3);
    align-items: center;
    min-block-size: 3rem;
    padding: var(--admin-space-2) var(--admin-space-4);
    border-block-start: 1px solid var(--admin-border);
  }

  .row:first-child {
    border-block-start: none;
  }

  .row.waiting {
    background: var(--admin-waiting-wash);
  }

  .row-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 0;
  }

  .row-title {
    overflow-wrap: anywhere;
    font-weight: 600;
    color: var(--admin-ink);
  }

  a.row-title {
    text-decoration: none;
  }

  a.row-title:hover {
    text-decoration: underline;
  }

  .row-line {
    font-size: 0.8125rem;
    color: var(--admin-ink-muted);
  }

  .row.waiting .row-line {
    color: var(--admin-waiting-on-wash);
  }

  .row-actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: var(--admin-space-2);
    align-items: center;
    justify-content: flex-end;
  }

  .chip {
    flex: none;
    padding: 0.125rem 0.5rem;
    border-radius: var(--admin-radius-state);
    background: var(--admin-neutral-wash);
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    color: var(--admin-neutral-on-wash);
  }

  .chip.good {
    background: var(--admin-accent-wash);
    color: var(--admin-accent-on-wash);
  }

  .chip.waiting {
    background: var(--admin-waiting-wash);
    color: var(--admin-waiting-on-wash);
  }

  .chip.danger {
    background: var(--admin-danger-wash);
    color: var(--admin-danger-on-wash);
  }

  a.chip {
    text-decoration: none;
  }

  a.chip:hover {
    text-decoration: underline;
  }

  .mono {
    font-family: var(--admin-font-mono);
    font-size: 0.8125rem;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--admin-ink-muted);
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-block-size: var(--admin-control);
    padding: var(--admin-control-pad) var(--admin-space-4);
    border: 1px solid var(--admin-border-strong);
    border-radius: var(--admin-radius-control);
    background: var(--admin-surface-raised);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    color: var(--admin-ink);
    cursor: pointer;
  }

  .button.small {
    padding-inline: var(--admin-space-3);
    font-size: 0.8125rem;
  }

  .button.primary {
    border-color: transparent;
    background: var(--admin-accent);
    font-weight: 600;
    color: var(--admin-accent-ink);
  }

  .button.danger {
    border-color: var(--admin-danger);
    color: var(--admin-danger);
  }

  .button.icon {
    inline-size: var(--admin-control);
    padding: 0.5rem;
  }

  .button.icon > * {
    inline-size: 1.125rem;
    block-size: 1.125rem;
  }

  .button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .button:focus-visible,
  a.row-title:focus-visible,
  a.chip:focus-visible,
  a.link:focus-visible {
    outline: 2px solid var(--admin-accent);
    outline-offset: 2px;
  }

  .state {
    padding: var(--admin-space-6);
    border: 1px dashed var(--admin-border);
    border-radius: var(--admin-radius);
    color: var(--admin-ink-muted);
  }

  .state.error,
  .refusal {
    display: flex;
    flex-wrap: wrap;
    gap: var(--admin-space-2) var(--admin-space-3);
    align-items: center;
    padding: var(--admin-space-3);
    border: 1px solid var(--admin-danger);
    border-radius: var(--admin-radius);
    background: var(--admin-danger-wash);
    color: var(--admin-danger-on-wash);
  }

  .saved {
    padding: var(--admin-space-3);
    border-radius: var(--admin-radius);
    background: var(--admin-accent-wash);
    color: var(--admin-accent-on-wash);
  }

  .facts {
    display: grid;
    gap: var(--admin-space-2);
    padding: var(--admin-space-4);
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius);
    background: var(--admin-surface-raised);
  }

  .fact {
    display: flex;
    flex-wrap: wrap;
    gap: var(--admin-space-1) var(--admin-space-4);
    justify-content: space-between;
  }

  .fact > dt {
    color: var(--admin-ink-muted);
  }

  .fact > dd {
    overflow-wrap: anywhere;
    text-align: end;
  }

  /* On a phone a row keeps its text on the first line and puts what can be
     pressed on a line of its own, where each control is wide enough to hit. */
  @media (max-width: 47.99rem) {
    .row.waiting {
      flex-direction: column;
      align-items: stretch;
    }

    .row.waiting .row-actions > .button {
      flex: 1;
    }
  }
`;
