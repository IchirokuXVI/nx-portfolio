import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { ShoppingProfileStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  GEOLOCATION_READER,
  SheetNavigation,
  type GeolocationReaderI,
} from '@portfolio/velista/platform';
import { SheetShell, SpinnerIcon } from '@portfolio/velista/ui';

/**
 * What the sheet is showing.
 *
 * A state and not a pile of booleans, because the four the user can end up in are
 * mutually exclusive and section 3.2 puts them in an order: say what will happen, ask,
 * show what came back, confirm it.
 *
 * `refused` is the whole of section 3.4 and is reachable two ways: the browser already
 * knew when the sheet opened, and the person said no when asked. Both are sticky, both
 * are unfixable from here, and both lead to the same sentence.
 */
type SheetState =
  | 'explaining'
  | 'locating'
  | 'resolved'
  | 'unplaceable'
  | 'refused'
  | 'unavailable'
  | 'failed'
  | 'saving';

/**
 * Letting the device say where you shop (plan 0058, section 3).
 *
 * ## The prompt is never raised by a page rendering
 *
 * `getCurrentPosition` is what raises the browser's permission dialog, and firing it
 * because a screen appeared is the pattern every browser penalises and every person
 * refuses. It happens here, on a press, and this sheet exists so that what the press is
 * about to do has somewhere to be said before that dialog appears.
 *
 * The one thing asked on open is {@link GeolocationReaderI.permission}, which prompts
 * nobody: it is how the sheet opens straight into its refused copy rather than offering
 * a button that cannot work.
 *
 * ## The coordinates do not become data
 *
 * The point goes to the server in one request and comes back as a postal code. It is
 * not stored, not on the profile, not in a log line, not in an event, and it is not held
 * on this component either: {@link _locate} passes it straight into the lookup and lets
 * it go. Only the code is written, with `source: DEVICE`. That is what makes the
 * sentence before the press honest, and it is the reason it may be said at all.
 *
 * ## Nothing is adopted silently
 *
 * The server holds centroids and not boundaries, so somebody at the edge of a large
 * rural code can be resolved into the neighbouring one (backend 0060, section 6).
 * Showing the answer and asking is the difference between an approximation and a wrong
 * fact about where a person lives. Cancelling writes nothing at all.
 *
 * ## The nearby box is ticked here and unticked on the page
 *
 * The same checkbox, two defaults, deliberately (section 5). Somebody typing one
 * specific code has usually named the place they mean; somebody who has just handed over
 * their location has asked to be found, and the neighbours are the point.
 */
@Component({
  selector: 'lib-location-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './location-sheet.html',
  styleUrl: './location-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationSheet {
  private readonly _store = inject(ShoppingProfileStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _reader = inject<GeolocationReaderI>(GEOLOCATION_READER);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  protected readonly state = signal<SheetState>('explaining');

  /** The code the lookup answered, held only until it is confirmed or dropped. */
  protected readonly resolved = signal<string | null>(null);

  /** On by default here, which is the asymmetry section 5 asks for. */
  protected readonly expandNearby = signal(true);

  /** The profile the page behind is editing, which is the one this writes to. */
  private readonly _profile = this._store.selected;

  protected readonly busy = computed(
    () => this.state() === 'locating' || this.state() === 'saving'
  );

  constructor() {
    // The one thing read on open, and it raises no prompt. A browser that will not
    // answer leaves the sheet explaining, which is right: the control stays, and
    // pressing it is how we find out.
    void this._reader.permission().then((permission) => {
      if (permission === 'denied') {
        this.state.set('refused');
      }
    });
  }

  /**
   * Ask the device, then ask the server.
   *
   * Two awaits and one visible state, because the person is waiting for one answer:
   * splitting "getting your position" from "looking it up" would name two steps of our
   * own plumbing to somebody who asked one question.
   */
  protected async locate(): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.state.set('locating');

    const outcome = await this._reader.read();

    if (outcome.state === 'denied') {
      this.state.set('refused');
      return;
    }

    if (outcome.state !== 'located') {
      // A device that could not place itself and one that took too long are the same
      // sentence and the same next step: try again, or type it.
      this.state.set('unavailable');
      return;
    }

    try {
      const answer = await this._store.resolvePostalCode(
        outcome.point.latitude,
        outcome.point.longitude
      );

      if (answer.postalCode === null) {
        // The server declined to guess across the distance. Not a failure, and it must
        // not read as one: the honest next step is typing the code.
        this.state.set('unplaceable');
        return;
      }

      this.resolved.set(answer.postalCode);
      this.state.set('resolved');
    } catch {
      // We could not ask. Distinct from `unplaceable` on purpose: this one is worth
      // trying again, and that one is not.
      this.state.set('failed');
    }
  }

  protected toggleNearby(event: Event): void {
    this.expandNearby.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Write the code the person confirmed, and leave.
   *
   * `leaveTo` and not `dismiss`: the sheet was opened from the page and the write has
   * landed, so there is a URL to go to rather than a history entry to pop.
   */
  protected async confirm(): Promise<void> {
    const profile = this._profile();
    const postalCode = this.resolved();
    if (profile === null || postalCode === null || this.busy()) {
      return;
    }

    this.state.set('saving');

    const outcome = await this._store.addPostalCode(profile.id, {
      postalCode,
      source: 'DEVICE',
      expandNearby: this.expandNearby(),
    });

    if (outcome === 'failed') {
      // Back to the answer rather than out of the sheet: the code is still right, and
      // the page's own failed treatment has nothing to draw for a write made from here.
      this.state.set('failed');
      return;
    }

    await this._sheet.leaveTo(this._pagePath());
  }

  /** Cancel, Escape and the scrim. Writes nothing, whatever state this was in. */
  protected async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._pagePath());
  }

  private _pagePath(): string {
    return appPath(this._locale(), this._basePath, 'account/profiles');
  }
}
