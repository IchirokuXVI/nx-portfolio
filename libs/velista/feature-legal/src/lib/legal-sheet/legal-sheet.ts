import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  SheetNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import { type LegalDocumentKind } from '../legal-document';
import { legalDocumentState } from '../legal-document-state';
import { LegalSections } from '../legal-sections/legal-sections';

/**
 * The privacy policy or the terms as a sheet over sign in, register or upgrade
 * (velista `0173`, target 6, D5).
 *
 * A sheet so nothing typed into the form underneath is lost: the form is the parent
 * route and stays alive below. The same reading and the same sections as the page;
 * a link from one document to the other opens the other sheet over the same form, and
 * the foot links the full page.
 *
 * Route data says which document (`document`). The page it covers is its parent
 * route, whose path gives the fallback of a dismiss on a cold load and the address of
 * the other sheet.
 */
@Component({
  selector: 'lib-legal-sheet',
  imports: [
    LegalSections,
    RokuTranslatorPipe,
    RouterLink,
    SheetShell,
    SpinnerIcon,
  ],
  templateUrl: './legal-sheet.html',
  styleUrl: './legal-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalSheet {
  private readonly _route = inject(ActivatedRoute);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Which document. Anything but `terms` in the route data is the policy. */
  readonly document: LegalDocumentKind =
    this._route.snapshot.data['document'] === 'terms' ? 'terms' : 'privacy';

  /** The covered page, as segments after the locale (`['auth', 'register']`). */
  private readonly _over: readonly string[] = (
    this._route.parent?.routeConfig?.path ?? ''
  )
    .split('/')
    .filter((segment) => segment !== '');

  readonly titleKey = `legal.${this.document}.title`;
  readonly unpublishedKey = `legal.${this.document}.unpublished`;

  private readonly _reading = legalDocumentState(
    this.document,
    computed(() => ({
      privacy: this._sheetUrl('privacy'),
      terms: this._sheetUrl('terms'),
    }))
  );

  readonly settings = this._reading.settings;
  readonly state = this._reading.state;
  readonly view = this._reading.view;
  readonly metaKey = this._reading.metaKey;
  readonly version = this._reading.version;
  readonly changedOn = this._reading.changedOn;

  /** The same document as a page, at the foot of the sheet. */
  readonly pageUrl = computed(() =>
    appPath(this._locale(), this._basePath, this.document)
  );

  /** Cancel, Escape, the scrim and the back button. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(this._locale(), this._basePath, ...this._over)
    );
  }

  retry(): void {
    this._reading.retry();
  }

  private _sheetUrl(kind: LegalDocumentKind): string {
    return appPath(
      this._locale(),
      this._basePath,
      ...this._over,
      ...sheetSegments(kind)
    );
  }
}
