import {
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { OperatorSettingsStore } from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import {
  loadLegalDocument,
  type LegalDocument,
  type LegalDocumentKind,
} from './legal-document';
import {
  renderLegalDocument,
  type LegalDocumentView,
  type LegalLinkTargets,
} from './render';

/** What a document's reader draws. */
export type LegalPageState = 'loading' | 'failed' | 'unpublished' | 'ready';

/** One document, read and filled, for the page and for the sheet (velista `0173`). */
export interface LegalDocumentState {
  readonly settings: Signal<OperatorSettings | null>;
  readonly state: Signal<LegalPageState>;
  /** The document, filled with this deployment's values, or null until both exist. */
  readonly view: Signal<LegalDocumentView | null>;
  /** The line under the title, as a key. */
  readonly metaKey: Signal<string>;
  /** The version, for the terms' line. */
  readonly version: Signal<string>;
  /** The date the document last changed, in the reader's language, or null. */
  readonly changedOn: Signal<string | null>;
  /** Try again: whichever half failed. */
  readonly retry: () => void;
}

/**
 * The page's reading of one document, shared with the sheet of velista `0173`, so the
 * two never disagree about what a document says or when it changed.
 *
 * Call it in an injection context. It loads one document in the reader's language,
 * again when the language changes (a later answer for an earlier language is dropped),
 * and joins it with the operator's settings. `links` says where the two link tokens go:
 * the pages for the page, the sheets for a sheet.
 */
export function legalDocumentState(
  document: LegalDocumentKind,
  links: Signal<LegalLinkTargets>
): LegalDocumentState {
  const store = inject(OperatorSettingsStore);
  const locale = inject(RokuLocaleStore).locale;

  const doc = signal<LegalDocument | null>(null);
  const docState = signal<'loading' | 'ready' | 'failed'>('loading');
  let request = 0;

  async function load(language: string): Promise<void> {
    const mine = ++request;
    docState.set('loading');
    try {
      const loaded = await loadLegalDocument(document, language);
      if (mine !== request) {
        return;
      }
      doc.set(loaded);
      docState.set(loaded === null ? 'failed' : 'ready');
    } catch {
      if (mine === request) {
        docState.set('failed');
      }
    }
  }

  effect(() => {
    const language = locale();
    untracked(() => void load(language));
  });

  const state = computed<LegalPageState>(() => {
    const settings = store.settings();
    if (settings === null) {
      return store.state() === 'failed' ? 'failed' : 'loading';
    }
    if (!settings.published) {
      return 'unpublished';
    }
    return docState();
  });

  const view = computed(() => {
    const settings = store.settings();
    const loaded = doc();
    if (settings === null || loaded === null || !settings.published) {
      return null;
    }
    return renderLegalDocument(loaded, settings, links());
  });

  // The terms name their version only when it is not the plain date of the line (an
  // operator's revision, `YYYY-MM-DD+YYYY-MM-DD`); otherwise the line would print the
  // same date twice.
  const metaKey = computed(() => {
    const terms = store.settings()?.terms;
    return document === 'terms' &&
      terms !== undefined &&
      terms.version !== terms.updatedOn
      ? 'legal.terms.metaVersion'
      : `legal.${document}.meta`;
  });

  const version = computed(() => store.settings()?.terms.version ?? '');

  // A calendar date: built in UTC and drawn in UTC, so no time zone can move it a day.
  const changedOn = computed(() => {
    const settings = store.settings();
    if (settings === null) {
      return null;
    }
    const date =
      document === 'terms'
        ? settings.terms.updatedOn
        : settings.privacyUpdatedOn;
    return formatCalendarDate(date, locale());
  });

  return {
    settings: store.settings,
    state,
    view,
    metaKey,
    version,
    changedOn,
    retry: () => {
      if (store.state() === 'failed') {
        store.reload();
      }
      if (docState() === 'failed') {
        void load(locale());
      }
    },
  };
}

/**
 * `YYYY-MM-DD` in the reader's language, or null. Through `Intl.DateTimeFormat` in a
 * `try`, never `DatePipe`: the language is runtime state and there is no `LOCALE_ID`.
 */
export function formatCalendarDate(
  date: string | null,
  locale: string
): string | null {
  if (date === null) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    return null;
  }
  try {
    const instant = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    );
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(instant);
  } catch {
    return null;
  }
}
