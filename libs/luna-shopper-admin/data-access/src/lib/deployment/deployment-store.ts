import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import {
  UNKNOWN_ENVIRONMENT,
  type AdminEnvironment,
} from '@portfolio/luna-shopper-admin/models';
import { ServerReachability } from '../health/server-reachability';
import { DEPLOYMENT_SERVICE } from './deployment-service';

/**
 * What the gateway says about itself, as signals every screen reads (plan 0001,
 * section 6; plan 0002, section 5).
 *
 * One read, once, held for the life of the tab. The answer cannot change under a
 * running app: it is a property of the gateway on the other end of a base URL
 * that is fixed at build time, so re-reading it would cost a request per screen
 * and could only ever confirm what it already said.
 *
 * `undefined` while the read is in flight and `null` when it failed, and the two
 * are told apart on purpose. Not knowing yet is a moment the page renders
 * through without saying anything; not being able to find out is a state it has
 * to show, because an operator who cannot see which environment they are in
 * should be told that rather than shown a default.
 */
@Injectable()
export class DeploymentStore {
  private readonly _service = inject(DEPLOYMENT_SERVICE);
  private readonly _reachability = inject(ServerReachability);
  private readonly _environment = signal<AdminEnvironment | undefined>(
    undefined
  );
  private readonly _unreachable = signal(false);

  /** The deployment, `null` if unknown, `undefined` until the read settles. */
  readonly deployment = computed(() => {
    const environment = this._environment();
    return environment === undefined ? undefined : environment.deployment;
  });

  /**
   * Whether this server will issue a token with no password.
   *
   * `false` until the read settles, which is the safe direction: the app shows
   * its login screen while it does not know, and skips it only once a server has
   * said in as many words that it may.
   */
  readonly devAutologin = computed(
    () => this._environment()?.devAutologin === true
  );

  /** Whether the one read has come back, either way. */
  readonly settled = computed(() => this._environment() !== undefined);

  /**
   * Whether the one read produced no response at all.
   *
   * Distinct from `deployment() === null`, which also covers a gateway that
   * answered with a name this app does not recognise. That one is a fact about
   * the deployment, and this one is a fact about the server.
   */
  readonly unreachable = this._unreachable.asReadonly();

  constructor() {
    // The environment read is the first request the app makes, so it is the
    // first thing an outage breaks. Without this the badge and the accent stay
    // "unknown" for the life of a tab that recovered in its first second.
    //
    // `untracked` because the re-read writes the very signals this effect would
    // otherwise depend on.
    effect(() => {
      const reachable = !this._reachability.down();
      untracked(() => {
        if (reachable) {
          this.reload();
        }
      });
    });
  }

  /**
   * Start the one read.
   *
   * Called from an environment initializer rather than from a component, so the
   * request is in flight from the moment the app injector exists and does not
   * wait on whichever screen happens to render first. Idempotent, so a second
   * caller costs nothing and gets the same promise: `0002`'s bootstrap awaits
   * this to decide whether to attempt an autologin, and must not start a second
   * request to do it.
   */
  load(): Promise<void> {
    this._loading ??= this._service.read().then(
      (environment) => {
        this._unreachable.set(false);
        this._environment.set(environment);
      },
      () => {
        // Nothing arrived (plan 0008, section 3). The read still settles, so the
        // app renders and the accent stays the resting grey; what changes is
        // that the caller can now tell this apart from a gateway that answered
        // something unreadable, and ask whether anything is there at all.
        this._unreachable.set(true);
        this._environment.set(UNKNOWN_ENVIRONMENT);
      }
    );

    return this._loading;
  }

  /**
   * Ask again, once the server is back.
   *
   * Only for a read that never arrived. A gateway that answered has answered:
   * the response cannot change under a running app, which is why {@link load}
   * holds one promise for the life of the tab, and re-reading it would cost a
   * request per outage to confirm what it already said.
   */
  private reload(): void {
    if (!this._unreachable()) {
      return;
    }

    this._loading = undefined;
    void this.load();
  }

  private _loading?: Promise<void>;
}
