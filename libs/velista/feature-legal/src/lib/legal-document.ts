/**
 * The shape of a legal document in this repository (velista `0172`, target 3).
 *
 * A structured file per document per language, read whole by the person who writes
 * it and loaded only by the page that draws it (D2). Not translation keys: a policy is
 * two thousand words that one visit in a thousand reads, and as keys it would ride in
 * the file every start downloads.
 *
 * Text holds placeholders (`{{appName}}` and the rest of {@link LEGAL_PLACEHOLDERS}),
 * replaced as text with the operator's values, and two link tokens, `[[privacy]]` and
 * `[[terms]]`, that draw a link to the other document. No HTML and no Markdown: this
 * shape is the format.
 */

/** Which of the two documents. Also the route data that picks one. */
export type LegalDocumentKind = 'privacy' | 'terms';

/**
 * A condition on a section, a block or a table row: drawn only while it holds (D3).
 *
 * The first five are the deployment's feature flags. The next four hold while the
 * operator has named that processor, so a sentence that prints a name sits behind the
 * condition that the name exists. `backupProvider` and `aiTextProvider` were added by
 * the build beside the plan's `emailProvider` and `hostingProvider`, for the same
 * reason: a backup host and an AI provider can be on with no name to print.
 *
 * `termsAcceptance` holds while the deployment asks people to accept the terms
 * (`terms.acceptanceRequired`), so a sentence about the app asking is drawn only
 * where the app asks.
 */
export type LegalFeature =
  | 'googleSignIn'
  | 'assistant'
  | 'transcription'
  | 'offsiteBackups'
  | 'supportAccess'
  | 'emailProvider'
  | 'hostingProvider'
  | 'backupProvider'
  | 'aiTextProvider'
  | 'termsAcceptance';

export const LEGAL_FEATURES: readonly LegalFeature[] = [
  'googleSignIn',
  'assistant',
  'transcription',
  'offsiteBackups',
  'supportAccess',
  'emailProvider',
  'hostingProvider',
  'backupProvider',
  'aiTextProvider',
  'termsAcceptance',
];

export interface LegalRow {
  readonly cells: readonly string[];
  readonly when?: LegalFeature;
}

export type LegalBlock =
  | {
      readonly kind: 'paragraph';
      readonly text: string;
      readonly when?: LegalFeature;
    }
  | {
      readonly kind: 'list';
      readonly items: readonly string[];
      readonly when?: LegalFeature;
    }
  | {
      readonly kind: 'table';
      readonly head: readonly string[];
      readonly rows: readonly LegalRow[];
    };

export interface LegalSection {
  /** Stable, and the same list in the same order in both languages. */
  readonly id: string;
  readonly when?: LegalFeature;
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  /** The day this text's meaning last changed, `YYYY-MM-DD` (section 5.4). */
  readonly templateVersion: string;
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

/** The placeholders a text may hold. Anything else is a spec failure, never drawn. */
export const LEGAL_PLACEHOLDERS = [
  'appName',
  'controllerName',
  'contactEmail',
  'termsVersion',
  'emailProvider',
  'hostingProvider',
  'backupProvider',
  'aiTextProvider',
  'auditTrailDays',
  'expiredGrantDays',
  'applicationLogDays',
  'assistantLogDays',
  'backupDays',
] as const;

export type LegalPlaceholder = (typeof LEGAL_PLACEHOLDERS)[number];

/** The two link tokens, `[[privacy]]` and `[[terms]]`. */
export const LEGAL_LINK_TOKENS: readonly LegalDocumentKind[] = [
  'privacy',
  'terms',
];

/** The locales a document is written in. Any other draws the English text. */
const LEGAL_LOCALES = ['en', 'es'] as const;

/**
 * Reads a document file into the shape, or null when it does not have it.
 *
 * The files are the repository's own, so a failure here is a build defect that the
 * documents spec catches first. At run time it still turns a bad file into the page's
 * failed state rather than an exception in a template.
 */
export function parseLegalDocument(raw: unknown): LegalDocument | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { templateVersion, title, sections } = raw;
  if (
    typeof templateVersion !== 'string' ||
    typeof title !== 'string' ||
    !Array.isArray(sections)
  ) {
    return null;
  }
  const parsed: LegalSection[] = [];
  for (const section of sections) {
    const next = parseSection(section);
    if (next === null) {
      return null;
    }
    parsed.push(next);
  }
  return { templateVersion, title, sections: parsed };
}

/**
 * Loads one document in one language, with a dynamic `import()` of that one file, so
 * the app's start never downloads a legal text and a reader downloads one document in
 * one language (target 3). The shape `VELISTA_UI_TRANSLATIONS` uses for its assets.
 */
export async function loadLegalDocument(
  kind: LegalDocumentKind,
  locale: string
): Promise<LegalDocument | null> {
  const language = (LEGAL_LOCALES as readonly string[]).includes(locale)
    ? locale
    : 'en';
  const module: unknown = await import(
    `../../assets/legal/${kind}.${language}.json`
  );
  const raw =
    isRecord(module) && isRecord(module['default'])
      ? module['default']
      : module;
  return parseLegalDocument(raw);
}

function parseSection(raw: unknown): LegalSection | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { id, heading, blocks } = raw;
  const when = parseWhen(raw['when']);
  if (
    typeof id !== 'string' ||
    typeof heading !== 'string' ||
    !Array.isArray(blocks) ||
    when === false
  ) {
    return null;
  }
  const parsed: LegalBlock[] = [];
  for (const block of blocks) {
    const next = parseBlock(block);
    if (next === null) {
      return null;
    }
    parsed.push(next);
  }
  return when === undefined
    ? { id, heading, blocks: parsed }
    : { id, heading, blocks: parsed, when };
}

function parseBlock(raw: unknown): LegalBlock | null {
  if (!isRecord(raw)) {
    return null;
  }
  const when = parseWhen(raw['when']);
  if (when === false) {
    return null;
  }
  const condition = when === undefined ? {} : { when };
  switch (raw['kind']) {
    case 'paragraph':
      return typeof raw['text'] === 'string'
        ? { kind: 'paragraph', text: raw['text'], ...condition }
        : null;
    case 'list': {
      const items = raw['items'];
      return isStrings(items) ? { kind: 'list', items, ...condition } : null;
    }
    case 'table': {
      const head = raw['head'];
      const rows = raw['rows'];
      if (!isStrings(head) || !Array.isArray(rows) || when !== undefined) {
        return null;
      }
      const parsed: LegalRow[] = [];
      for (const row of rows) {
        if (!isRecord(row) || !isStrings(row['cells'])) {
          return null;
        }
        const rowWhen = parseWhen(row['when']);
        if (rowWhen === false) {
          return null;
        }
        parsed.push(
          rowWhen === undefined
            ? { cells: row['cells'] }
            : { cells: row['cells'], when: rowWhen }
        );
      }
      return { kind: 'table', head, rows: parsed };
    }
    default:
      return null;
  }
}

/** A condition, `undefined` for none, or `false` for one this build does not know. */
function parseWhen(raw: unknown): LegalFeature | undefined | false {
  if (raw === undefined) {
    return undefined;
  }
  return typeof raw === 'string' &&
    (LEGAL_FEATURES as readonly string[]).includes(raw)
    ? (raw as LegalFeature)
    : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}
