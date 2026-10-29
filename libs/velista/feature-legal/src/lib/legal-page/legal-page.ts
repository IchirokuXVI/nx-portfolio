import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import {
  ChevronDownIcon,
  PageHeader,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import { type LegalDocumentKind } from '../legal-document';
import { legalDocumentState } from '../legal-document-state';
import { LegalSections } from '../legal-sections/legal-sections';

export {
  formatCalendarDate,
  type LegalPageState,
} from '../legal-document-state';

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
    LegalSections,
    PageHeader,
    RokuTranslatorPipe,
    SpinnerIcon,
  ],
  templateUrl: './legal-page.html',
  styleUrl: './legal-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPage {
  private readonly _route = inject(ActivatedRoute);
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

  /** The sentence of a deployment that has published nothing, as a key. */
  readonly unpublishedKey = `legal.${this.document}.unpublished`;

  /**
   * The document and the settings, read the way the sheet of velista `0173` reads
   * them. Its links go to the pages.
   */
  private readonly _reading = legalDocumentState(
    this.document,
    computed(() => ({
      privacy: appPath(this._locale(), this._basePath, 'privacy'),
      terms: appPath(this._locale(), this._basePath, 'terms'),
    }))
  );

  private _fragmentConsumed = false;

  readonly settings = this._reading.settings;

  readonly state = this._reading.state;

  /** The document, filled with this deployment's values, or null until both exist. */
  readonly view = this._reading.view;

  /**
   * The line under the title, as a key. The terms name their version only when it is
   * not the plain date of the line.
   */
  readonly metaKey = this._reading.metaKey;

  /** The version, for the terms' line. */
  readonly version = this._reading.version;

  /** The date the document last changed, in the reader's language, or null. */
  readonly changedOn = this._reading.changedOn;

  /** This page's own address, for the contents' links. */
  readonly pageUrl = computed(() =>
    appPath(this._locale(), this._basePath, this.document)
  );

  constructor() {
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
    this._reading.retry();
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
}
