import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { OperatorSettingsStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  ChevronDownIcon,
  PageHeader,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import {
  loadLegalDocument,
  type LegalDocument,
  type LegalDocumentKind,
} from '../legal-document';
import { renderLegalDocument } from '../render';

/** What the page draws. */
export type LegalPageState = 'loading' | 'failed' | 'unpublished' | 'ready';

/**
 * The privacy policy or the terms (velista `0172`, target 5), told which by route
 * data (`{ document: 'privacy' | 'terms' }`).
 *
 * ## Public, and behind the startup gate
 *
 * The route names no guard (D1): Google's review needs the policy signed out, and plan
 * `0173`'s prompt links here. It still waits behind the startup gate like every page but
 * the front door, because every sentence about the controller comes from the backend,
 * and a page drawn without it would print blanks where the law wants a name.
 *
 * ## What it draws
 *
 * The text is the repository's (one file per document per language, loaded on demand),
 * and the values are the operator's (`OperatorSettingsStore`). `renderLegalDocument`
 * joins them and drops what a deployment has switched off. The template binds the runs
 * with interpolation only: there is no `innerHTML` in this library.
 *
 * When the operator has published nothing, the page draws one sentence instead of a
 * template, because a policy with no controller is not a policy.
 */
@Component({
  selector: 'lib-legal-page',
  imports: [
    ChevronDownIcon,
    NgTemplateOutlet,
    PageHeader,
    RokuTranslatorPipe,
    RouterLink,
    SpinnerIcon,
  ],
  templateUrl: './legal-page.html',
  styleUrl: './legal-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _store = inject(OperatorSettingsStore);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _pages = inject(PageNavigation);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);

  /** Which document. Anything but `terms` in the route data is the policy. */
  readonly document: LegalDocumentKind =
    this._route.snapshot.data['document'] === 'terms' ? 'terms' : 'privacy';

  /** The header's title, as a key. The same key titles the route and the links. */
  readonly titleKey = `legal.${this.document}.title`;

  /**
   * The line under the title, as a key. The terms name their version only when it is
   * not the plain date of the line (an operator's revision, `YYYY-MM-DD+YYYY-MM-DD`);
   * otherwise the line would print the same date twice.
   */
  readonly metaKey = computed(() => {
    const terms = this._store.settings()?.terms;
    return this.document === 'terms' &&
      terms !== undefined &&
      terms.version !== terms.updatedOn
      ? 'legal.terms.metaVersion'
      : `legal.${this.document}.meta`;
  });

  /** The sentence of a deployment that has published nothing, as a key. */
  readonly unpublishedKey = `legal.${this.document}.unpublished`;

  private readonly _doc = signal<LegalDocument | null>(null);
  private readonly _docState = signal<'loading' | 'ready' | 'failed'>(
    'loading'
  );
  private _docRequest = 0;
  private _fragmentConsumed = false;

  readonly settings = this._store.settings;

  readonly state = computed<LegalPageState>(() => {
    const settings = this._store.settings();
    const storeState = this._store.state();
    if (settings === null) {
      return storeState === 'failed' ? 'failed' : 'loading';
    }
    if (!settings.published) {
      return 'unpublished';
    }
    const docState = this._docState();
    return docState === 'ready' ? 'ready' : docState;
  });

  /** The document, filled with this deployment's values, or null until both exist. */
  readonly view = computed(() => {
    const settings = this._store.settings();
    const doc = this._doc();
    if (settings === null || doc === null || !settings.published) {
      return null;
    }
    const locale = this._locale();
    return renderLegalDocument(doc, settings, {
      privacy: appPath(locale, this._basePath, 'privacy'),
      terms: appPath(locale, this._basePath, 'terms'),
    });
  });

  /** The version, for the terms' line. */
  readonly version = computed(
    () => this._store.settings()?.terms.version ?? ''
  );

  /**
   * The date the document last changed, in the reader's language, or null to leave
   * the line out. A calendar date: built in UTC and drawn in UTC, so no time zone can
   * move it a day.
   */
  readonly changedOn = computed(() => {
    const settings = this._store.settings();
    if (settings === null) {
      return null;
    }
    const date =
      this.document === 'terms'
        ? settings.terms.updatedOn
        : settings.privacyUpdatedOn;
    return formatCalendarDate(date, this._locale());
  });

  /** This page's own address, for the contents' links. */
  readonly pageUrl = computed(() =>
    appPath(this._locale(), this._basePath, this.document)
  );

  constructor() {
    // One document in the reader's language, again when the language changes. A later
    // answer for an earlier language is dropped.
    effect(() => {
      const locale = this._locale();
      untracked(() => void this._loadDocument(locale));
    });

    // A cold arrival on `/en/privacy#rights` lands on that section once it is drawn.
    effect(() => {
      const view = this.view();
      if (view === null || this._fragmentConsumed) {
        return;
      }
      const fragment = this._route.snapshot.fragment;
      this._fragmentConsumed = true;
      if (
        fragment &&
        view.sections.some((section) => section.id === fragment)
      ) {
        // Scrolled to and not focused: nobody pressed anything, so no ring is drawn.
        afterNextRender(() => this._showSection(fragment, false), {
          injector: this._injector,
        });
      }
    });
  }

  /** The chevron. Back pops when it can; otherwise the front door, which sends a
   * signed in reader on to home. */
  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath));
  }

  /** Try again: whichever half failed. */
  retry(): void {
    if (this._store.state() === 'failed') {
      this._store.reload();
    }
    if (this._docState() === 'failed') {
      void this._loadDocument(this._locale());
    }
  }

  /**
   * A press in the contents. The link carries a real address (`/en/privacy#rights`)
   * for a long press or a copy; the press itself scrolls this page's own scroller and
   * moves focus to the heading, which a router navigation to a fragment would not do
   * inside a scrolling element.
   */
  jump(event: Event, id: string): void {
    event.preventDefault();
    this._showSection(id, true);
  }

  private _showSection(id: string, focus: boolean): void {
    const heading = this._host.nativeElement.querySelector<HTMLElement>(
      `[data-section="${id}"]`
    );
    if (heading === null) {
      return;
    }
    if (typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ block: 'start' });
    }
    if (focus) {
      heading.focus({ preventScroll: true });
    }
  }

  private async _loadDocument(locale: string): Promise<void> {
    const request = ++this._docRequest;
    this._docState.set('loading');
    try {
      const doc = await loadLegalDocument(this.document, locale);
      if (request !== this._docRequest) {
        return;
      }
      this._doc.set(doc);
      this._docState.set(doc === null ? 'failed' : 'ready');
    } catch {
      if (request === this._docRequest) {
        this._docState.set('failed');
      }
    }
  }
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
