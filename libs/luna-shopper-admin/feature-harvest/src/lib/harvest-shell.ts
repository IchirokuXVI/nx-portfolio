import { computed, inject, Injectable, signal } from '@angular/core';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  harvesterDeployed,
  harvestSwitches,
  type HarvestRun,
  type RunBlockReason,
} from '@portfolio/luna-shopper-admin/models';

/**
 * What every harvester screen needs to know before it draws anything.
 *
 * Two questions, and they are the same question asked from two directions.
 * Section 4 asks whether an empty screen means "nothing has happened" or "there
 * is no harvester here", and section 3 asks which of the two switches are off.
 * Both are answered from the deployment plus whatever this app has actually
 * observed, so they are answered once, here, rather than five times.
 *
 * Root scoped on purpose. What has been observed is worth carrying between the
 * screens: a spawn refused on the runs screen is the same fact when the sources
 * screen wants to explain why nothing is fetching, and asking the operator to
 * rediscover it per screen would be worse for no gain.
 */
@Injectable({ providedIn: 'root' })
export class HarvestShell {
  private readonly _deployments = inject(DeploymentStore);

  private readonly _reachable = signal<boolean | null>(null);
  private readonly _spawnRefusal = signal<RunBlockReason | null>(null);
  private readonly _recentRuns = signal<readonly HarvestRun[]>([]);

  /**
   * Whether the chart renders the harvester in this deployment at all.
   *
   * From `values.production.yaml` and `values.staging.yaml`, which switch it off
   * in both clusters deliberately (plan 0006, section 4). This is the fact that
   * lets a failed read in production say "not deployed here" instead of "the
   * gateway did not answer", which is the difference between an expected absence
   * and a bug somebody is going to chase.
   */
  readonly deployed = computed(() =>
    harvesterDeployed(this._deployments.deployment())
  );

  /** The two switches of section 3, with the unknown one left unknown. */
  readonly switches = computed(() =>
    harvestSwitches({
      deployment: this._deployments.deployment(),
      reachable: this._reachable(),
      spawnRefusal: this._spawnRefusal(),
      recentRuns: this._recentRuns(),
    })
  );

  /**
   * Whether a failed read on this screen means the harvester is simply absent.
   *
   * A read that has answered before settles it: something is listening, so a
   * later failure is a failure. Otherwise the chart decides.
   */
  readonly absent = computed(
    () => this._reachable() !== true && !this.deployed()
  );

  /** A read answered, so something is there. */
  observeReachable(): void {
    this._reachable.set(true);
  }

  /**
   * A read failed.
   *
   * Only ever downgrades an unknown, never an observed success. One failed poll
   * on a screen that has been working for ten minutes does not mean the service
   * was never deployed, and letting it say so would put the "not deployed here"
   * notice in front of a developer whose compose stack merely hiccuped.
   */
  observeFailure(): void {
    if (this._reachable() === null) {
      this._reachable.set(false);
    }
  }

  /** What the harvester said when it refused to start a run. */
  observeSpawnRefusal(reason: RunBlockReason | null): void {
    this._spawnRefusal.set(reason);
  }

  /** The runs the list last saw, which is where a service refusal shows. */
  observeRuns(runs: readonly HarvestRun[]): void {
    this._recentRuns.set(runs);
  }
}
