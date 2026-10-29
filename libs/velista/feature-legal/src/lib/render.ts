import type {
  OperatorAiTextProvider,
  OperatorSettings,
} from '@portfolio/velista/models';
import {
  LEGAL_LINK_TOKENS,
  LEGAL_PLACEHOLDERS,
  type LegalBlock,
  type LegalDocument,
  type LegalDocumentKind,
  type LegalFeature,
  type LegalPlaceholder,
} from './legal-document';

/** Where the two link tokens point: app paths the page builds with `appPath`. */
export interface LegalLinkTargets {
  readonly privacy: string;
  readonly terms: string;
}

/**
 * One piece of a drawn text. The template binds each with interpolation only: no
 * `innerHTML`, no `DomSanitizer` (target 4).
 */
export type LegalRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'email'; readonly email: string }
  | {
      readonly kind: 'link';
      readonly document: LegalDocumentKind;
      readonly href: string;
    };

export type LegalBlockView =
  | { readonly kind: 'paragraph'; readonly runs: readonly LegalRun[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly LegalRun[])[] }
  | {
      readonly kind: 'table';
      readonly head: readonly string[];
      readonly rows: readonly (readonly (readonly LegalRun[])[])[];
    };

export interface LegalSectionView {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly LegalBlockView[];
}

export interface LegalDocumentView {
  readonly title: string;
  readonly sections: readonly LegalSectionView[];
}

/**
 * The name drawn for each AI provider. A fixed table in velista, so the policy never
 * prints a wire value.
 */
const AI_TEXT_PROVIDER_NAMES: Readonly<Record<OperatorAiTextProvider, string>> =
  {
    anthropic: 'Anthropic',
  };

/**
 * The condition under which each placeholder that can be empty has a value. A text
 * that prints one must sit behind one of these (the documents spec checks it).
 * `controllerName` and `contactEmail` are absent: a document is drawn only when the
 * deployment is published, which means both are set.
 */
export const NULLABLE_PLACEHOLDERS: Readonly<
  Partial<Record<LegalPlaceholder, readonly LegalFeature[]>>
> = {
  emailProvider: ['emailProvider'],
  hostingProvider: ['hostingProvider'],
  backupProvider: ['backupProvider'],
  aiTextProvider: ['aiTextProvider'],
  backupDays: ['offsiteBackups', 'backupProvider'],
};

/** `{{name}}` or `[[name]]`. */
const TOKEN = /\{\{([^{}]*)\}\}|\[\[([^[\]]*)\]\]/g;

/** Whether a condition holds for this deployment. */
export function legalFeatureOn(
  settings: OperatorSettings,
  feature: LegalFeature
): boolean {
  switch (feature) {
    case 'emailProvider':
      return settings.processors.email !== null;
    case 'hostingProvider':
      return settings.processors.hosting !== null;
    case 'backupProvider':
      return (
        settings.features.offsiteBackups &&
        settings.processors.offsiteBackups !== null
      );
    case 'aiTextProvider':
      return settings.features.assistant && settings.processors.aiText !== null;
    case 'termsAcceptance':
      return settings.terms.acceptanceRequired;
    default:
      return settings.features[feature];
  }
}

/** What each placeholder prints for this deployment, or null when it has no value. */
export function legalPlaceholderValues(
  settings: OperatorSettings
): Readonly<Record<LegalPlaceholder, string | null>> {
  const retention = settings.retention;
  return {
    appName: settings.appName,
    controllerName: settings.controllerName,
    contactEmail: settings.contactEmail,
    termsVersion: settings.terms.version,
    emailProvider: settings.processors.email,
    hostingProvider: settings.processors.hosting,
    backupProvider: settings.features.offsiteBackups
      ? settings.processors.offsiteBackups
      : null,
    aiTextProvider:
      settings.features.assistant && settings.processors.aiText !== null
        ? AI_TEXT_PROVIDER_NAMES[settings.processors.aiText]
        : null,
    auditTrailDays: String(retention.auditTrailDays),
    expiredGrantDays: String(retention.expiredGrantDays),
    applicationLogDays: String(retention.applicationLogDays),
    assistantLogDays: String(retention.assistantLogDays),
    backupDays:
      settings.features.offsiteBackups && retention.backupDays !== null
        ? String(retention.backupDays)
        : null,
  };
}

/**
 * A document filled with one deployment's values (target 4). Pure: the same three
 * arguments always give the same view.
 *
 * - A section, a block or a table row whose condition does not hold is dropped.
 * - Placeholders are replaced as text, so an operator value holding `<b>` is drawn as
 *   those three characters. Every `{{contactEmail}}` becomes a mail link, and the two
 *   link tokens become links to the other document.
 * - A placeholder with no value drops the text that holds it (a list item, a block, a
 *   row, or a section for a heading) rather than print a blank. The documents spec
 *   proves no shipped text reaches this, because each such placeholder sits behind the
 *   condition that gives it a value; this is the floor under that proof.
 * - An unknown placeholder or token is never drawn: it drops its text the same way,
 *   and the documents spec fails on it.
 */
export function renderLegalDocument(
  doc: LegalDocument,
  settings: OperatorSettings,
  links: LegalLinkTargets
): LegalDocumentView {
  const values = legalPlaceholderValues(settings);
  const holds = (when: LegalFeature | undefined) =>
    when === undefined || legalFeatureOn(settings, when);
  const runs = (text: string) => toRuns(text, values, links);

  const sections: LegalSectionView[] = [];
  for (const section of doc.sections) {
    if (!holds(section.when)) {
      continue;
    }
    const heading = plain(runs(section.heading));
    if (heading === null) {
      continue;
    }
    const blocks: LegalBlockView[] = [];
    for (const block of section.blocks) {
      const view = renderBlock(block, holds, runs);
      if (view !== null) {
        blocks.push(view);
      }
    }
    sections.push({ id: section.id, heading, blocks });
  }

  return { title: doc.title, sections };
}

function renderBlock(
  block: LegalBlock,
  holds: (when: LegalFeature | undefined) => boolean,
  runs: (text: string) => LegalRun[] | null
): LegalBlockView | null {
  switch (block.kind) {
    case 'paragraph': {
      if (!holds(block.when)) {
        return null;
      }
      const drawn = runs(block.text);
      return drawn === null ? null : { kind: 'paragraph', runs: drawn };
    }
    case 'list': {
      if (!holds(block.when)) {
        return null;
      }
      const items = block.items
        .map(runs)
        .filter((item): item is LegalRun[] => item !== null);
      return items.length === 0 ? null : { kind: 'list', items };
    }
    case 'table': {
      const rows: LegalRun[][][] = [];
      for (const row of block.rows) {
        if (!holds(row.when)) {
          continue;
        }
        const cells = row.cells.map(runs);
        if (cells.every((cell): cell is LegalRun[] => cell !== null)) {
          rows.push(cells);
        }
      }
      return rows.length === 0
        ? null
        : { kind: 'table', head: block.head, rows };
    }
  }
}

/**
 * A text split into runs, or null when a placeholder in it has no value or a token in
 * it is not one this build knows.
 */
function toRuns(
  text: string,
  values: Readonly<Record<LegalPlaceholder, string | null>>,
  links: LegalLinkTargets
): LegalRun[] | null {
  const runs: LegalRun[] = [];
  const pushText = (piece: string) => {
    if (piece === '') {
      return;
    }
    const last = runs[runs.length - 1];
    if (last?.kind === 'text') {
      runs[runs.length - 1] = { kind: 'text', text: last.text + piece };
    } else {
      runs.push({ kind: 'text', text: piece });
    }
  };

  let index = 0;
  for (const match of text.matchAll(TOKEN)) {
    pushText(text.slice(index, match.index));
    index = (match.index ?? 0) + match[0].length;

    const [, placeholder, link] = match;
    if (link !== undefined) {
      if (!(LEGAL_LINK_TOKENS as readonly string[]).includes(link)) {
        return null;
      }
      const document = link as LegalDocumentKind;
      runs.push({ kind: 'link', document, href: links[document] });
      continue;
    }

    if (!isPlaceholder(placeholder)) {
      return null;
    }
    const value = values[placeholder];
    if (value === null) {
      return null;
    }
    if (placeholder === 'contactEmail') {
      runs.push({ kind: 'email', email: value });
    } else {
      pushText(value);
    }
  }
  pushText(text.slice(index));
  return runs;
}

/** A heading is drawn as text: a mail or a link inside it is drawn as its text. */
function plain(runs: LegalRun[] | null): string | null {
  if (runs === null) {
    return null;
  }
  return runs
    .map((run) =>
      run.kind === 'text' ? run.text : run.kind === 'email' ? run.email : ''
    )
    .join('');
}

function isPlaceholder(name: string): name is LegalPlaceholder {
  return (LEGAL_PLACEHOLDERS as readonly string[]).includes(name);
}

/**
 * Everything wrong with a document file, as sentences, for the documents spec. Empty
 * for a file the renderer can draw for every deployment:
 *
 * - every placeholder and link token is one this build knows;
 * - every placeholder that can be empty sits behind a condition that gives it a value;
 * - every table row has as many cells as the table has columns;
 * - no section id repeats.
 */
export function legalDocumentProblems(doc: LegalDocument): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  const check = (
    where: string,
    text: string,
    conditions: readonly (LegalFeature | undefined)[]
  ) => {
    for (const match of text.matchAll(TOKEN)) {
      const [whole, placeholder, link] = match;
      if (link !== undefined) {
        if (!(LEGAL_LINK_TOKENS as readonly string[]).includes(link)) {
          problems.push(`${where}: unknown link token ${whole}`);
        }
        continue;
      }
      if (!isPlaceholder(placeholder)) {
        problems.push(`${where}: unknown placeholder ${whole}`);
        continue;
      }
      const needs = NULLABLE_PLACEHOLDERS[placeholder];
      if (
        needs !== undefined &&
        !conditions.some((when) => when !== undefined && needs.includes(when))
      ) {
        problems.push(
          `${where}: ${whole} can be empty and needs when: ${needs.join(' or ')}`
        );
      }
    }
    // A brace or bracket left over is a placeholder spelled wrong.
    if (/\{\{|\}\}|\[\[|\]\]/.test(text.replace(TOKEN, ''))) {
      problems.push(`${where}: a malformed placeholder or token`);
    }
  };

  for (const section of doc.sections) {
    if (seen.has(section.id)) {
      problems.push(`section ${section.id}: the id repeats`);
    }
    seen.add(section.id);
    const at = `section ${section.id}`;
    check(`${at} heading`, section.heading, [section.when]);
    section.blocks.forEach((block, b) => {
      switch (block.kind) {
        case 'paragraph':
          check(`${at} block ${b}`, block.text, [section.when, block.when]);
          break;
        case 'list':
          block.items.forEach((item, i) =>
            check(`${at} block ${b} item ${i}`, item, [
              section.when,
              block.when,
            ])
          );
          break;
        case 'table':
          block.head.forEach((cell, c) =>
            check(`${at} block ${b} head ${c}`, cell, [section.when])
          );
          block.rows.forEach((row, r) => {
            if (row.cells.length !== block.head.length) {
              problems.push(
                `${at} block ${b} row ${r}: ${row.cells.length} cells for ${block.head.length} columns`
              );
            }
            row.cells.forEach((cell, c) =>
              check(`${at} block ${b} row ${r} cell ${c}`, cell, [
                section.when,
                row.when,
              ])
            );
          });
          break;
      }
    });
  }

  return problems;
}
