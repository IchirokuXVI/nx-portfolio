import { HttpClient } from '@angular/common/http';
import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  Injector,
  untracked,
} from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  APP_BASE_PATH,
  APP_KEY,
  type SessionTokens,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  ImpersonationState,
  readAccessTokenActor,
  StorageKeys,
} from '@portfolio/velista/platform';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiUrl } from '../api-url';
import { GatewayError } from '../errors';
import { toSessionTokens } from '../mapping/mappers';
import { anonymous, operation } from './http-context';
import { TokenStore } from './token-store';

/** What the handoff page gets for its code. */
export type ImpersonationExchange =
  | { readonly state: 'opened'; readonly tokens: SessionTokens }
  /** Missing, used, too old or ended: the server gives one answer for all four. */
  | { readonly state: 'invalid' }
  /** No answer, or one this app cannot read. The code may still be good. */
  | { readonly state: 'failed' };

/**
 * How long "End" waits for the server before it ends the tab anyway (velista `0133`,
 * target 7). The tab ends either way; the request only makes the end exact on the
 * server rather than at the deadline.
 */
export const IMPERSONATION_END_WAIT_MS = 3_000;

/** The path of the page a tab lands on when its support session is over. */
export const SUPPORT_ENDED_SEGMENTS = ['auth', 'support-ended'] as const;

/**
 * A support session in this tab: the handoff, the strip's state, and the end
 * (velista `0133`, backend `0194`).
 *
 * ## The handoff
 *
 * {@link exchange} trades the code for a pair and {@link begin} stores it. `begin`
 * writes the marker and the pair to `sessionStorage` itself rather than through
 * `TokenStore`, because the document it runs in is usually an ordinary one, whose
 * facade still points at `localStorage` and whose `TokenStore` holds the operator's own
 * account. It then loads home as a new document, and that document starts with the
 * marker, so every store in it reads the storage of the tab.
 *
 * ## In an active tab
 *
 * The service follows the pair. It writes the name and the deadline into
 * `ImpersonationState` for the strip, sets a timer for the deadline, and ends the tab
 * on any of three causes, which all do the same (target 7):
 *
 * - "End" on the strip, which first tells the server and waits a few seconds at most;
 * - the clock reaching the deadline;
 * - the server refusing the session: a 401 `impersonation_ended` reported by the
 *   interceptor, or a refused refresh, which `TokenStore` answers by dropping the pair.
 *
 * A pair with no `act` claim in an active tab is a defect, and ends the tab too.
 *
 * Ending removes the pair, the marker and every other key of this app from the tab,
 * and loads the ended page as a new document. That document starts with no marker, so
 * it is an ordinary tab, and so is any reload of it.
 *
 * In an ordinary tab nothing here runs except the handoff.
 */
// Provided by the app layer, never root: rule D5. It reaches `TokenStore`.
@Injectable()
export class ImpersonationSession {
  private readonly _browser = inject(BrowserFacade);
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _tokens = inject(TokenStore);
  private readonly _state = inject(ImpersonationState);
  private readonly _i18n = inject(RokuTranslatorService);
  // Read when a path is built rather than here, so an ordinary tab that never
  // builds one constructs this service with nothing the app layer supplies.
  private readonly _injector = inject(Injector);

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _ending = false;
  private _pressed = false;

  constructor() {
    if (!this._state.active) {
      return;
    }

    this._state.handleEnd(() => void this.endByHand());

    effect(() => {
      const tokens = this._tokens.tokens();
      untracked(() => this._follow(tokens));
    });

    inject(DestroyRef).onDestroy(() => this._clearTimer());
  }

  /**
   * `POST /v1/auth/impersonation/exchange`, anonymous: no token of the operator's goes
   * with it. Rule D4: the answer is mapped from `unknown`, and one this app cannot read
   * is a failure rather than a session.
   */
  async exchange(code: string): Promise<ImpersonationExchange> {
    try {
      const body = await firstValueFrom(
        this._http.post<unknown>(
          this._urls.gateway('/v1/auth/impersonation/exchange'),
          { code },
          { context: anonymous('auth.impersonation.exchange') }
        )
      );
      const tokens = toSessionTokens(body);
      return tokens === null
        ? { state: 'failed' }
        : { state: 'opened', tokens };
    } catch (error) {
      return error instanceof GatewayError &&
        error.code === 'impersonation_code_invalid'
        ? { state: 'invalid' }
        : { state: 'failed' };
    }
  }

  /**
   * Make this tab hold the session, then load home as a new document.
   *
   * The marker first and the pair second, so no document can start with the pair of
   * the user and no marker, which would read the operator's storage beside it.
   */
  begin(tokens: SessionTokens): void {
    this._browser.removeSessionStorageWhere(isAppKey);
    this._browser.writeSessionStorage(StorageKeys.supportSession, '1');
    this._browser.writeSessionStorage(
      StorageKeys.session,
      JSON.stringify(tokens)
    );
    this._browser.replaceDocument(this._path('home'));
  }

  /**
   * "End" on the strip. Tells the server, waits for it a few seconds at most, and ends
   * the tab whatever the answer was, or whether there was one.
   */
  async endByHand(): Promise<void> {
    if (!this._state.active || this._ending || this._pressed) {
      return;
    }
    this._pressed = true;

    try {
      await firstValueFrom(
        this._http
          .post<unknown>(
            this._urls.gateway('/v1/auth/impersonation/end'),
            {},
            { context: operation('auth.impersonation.end') }
          )
          .pipe(timeout(IMPERSONATION_END_WAIT_MS))
      );
    } catch {
      // A failure, a refusal or no answer in time. The tab ends all the same: the
      // server stops the session at its deadline whatever happens here.
    }

    this._finish();
  }

  /** The gateway answered 401 `impersonation_ended`. Called by the interceptor. */
  endedByServer(): void {
    if (this._state.active) {
      this._finish();
    }
  }

  private _follow(tokens: SessionTokens | null): void {
    this._clearTimer();

    const actor =
      tokens === null ? null : readAccessTokenActor(tokens.accessToken);
    if (tokens === null || actor === null) {
      // No pair: the server refused a refresh and `TokenStore` dropped it, or the tab
      // started with none. A pair with no `act`: a defect. Either way the session is
      // over in this tab.
      this._finish();
      return;
    }

    this._state.show({ username: tokens.username, until: actor.until });

    const left = actor.until.getTime() - Date.now();
    if (left <= 0) {
      this._finish();
      return;
    }
    this._timer = setTimeout(() => this._finish(), left);
  }

  private _finish(): void {
    if (this._ending) {
      return;
    }
    this._ending = true;
    this._clearTimer();

    // Straight to storage, not through `TokenStore.clear()`: a signal change would wake
    // the guards and the pages of a document that is about to be replaced.
    this._browser.removeSessionStorageWhere(isAppKey);
    this._browser.replaceDocument(this._path(...SUPPORT_ENDED_SEGMENTS));
  }

  private _path(...segments: string[]): string {
    return appPath(
      this._i18n.getLocale(),
      this._injector.get(APP_BASE_PATH),
      ...segments
    );
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

/** Every key this app writes is `{role}:{appKey}` or `{role}:{appKey}:{id}`. */
function isAppKey(key: string): boolean {
  return key.endsWith(`:${APP_KEY}`) || key.includes(`:${APP_KEY}:`);
}
