import { PATH_METADATA } from '@nestjs/common/constants';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import 'reflect-metadata';
import { HealthController } from './health.module';

/**
 * The chart's probe paths, asserted against the controller's own route strings
 * (plan 0027, section 1).
 *
 * Both probes used to point at a bare `/health`. The controller is
 * `@Controller('health')` with `@Get('live')` and `@Get('ready')` under it and no
 * handler at the bare path, so both probes took a 404. That did not fail the
 * rollout — with `rollout.maxUnavailable: 0` readiness never passing means
 * Kubernetes may never retire an old pod, so the rollout HANGS at zero available
 * replicas while `helm upgrade` (which does not wait) reports success.
 *
 * A one line bug that would have cost the entire first deploy, and the kind that
 * comes back. Two files have to agree and nothing checked that they did; this is
 * that check, and it fails from either side.
 */
describe('health probe paths', () => {
  /** Walk up to the directory holding nx.json, so this works under any cwd. */
  function workspaceRoot(): string {
    let dir = __dirname;
    while (!existsSync(join(dir, 'nx.json'))) {
      const parent = dirname(dir);
      if (parent === dir) throw new Error('could not locate the workspace root');
      dir = parent;
    }
    return dir;
  }

  const chart = readFileSync(
    resolve(
      workspaceRoot(),
      'k8s/helm/templates/luna-shopper-backend/deployment.yaml.tpl'
    ),
    'utf8'
  );

  /** The `path:` under a named probe in the rendered deployment template. */
  function probePath(probe: 'readinessProbe' | 'livenessProbe'): string {
    const match = new RegExp(`${probe}:\\s*\\n\\s*httpGet:\\s*\\n\\s*path: (\\S+)`).exec(
      chart
    );
    if (!match) throw new Error(`no ${probe} httpGet path in the deployment template`);
    return match[1];
  }

  /** The controller prefix and one handler's route, as Nest itself sees them. */
  function routeOf(handler: 'live' | 'ready'): string {
    const prefix = Reflect.getMetadata(PATH_METADATA, HealthController);
    const suffix = Reflect.getMetadata(
      PATH_METADATA,
      HealthController.prototype[handler]
    );
    return `/${prefix}/${suffix}`;
  }

  it('points the readiness probe at the ready handler', () => {
    expect(probePath('readinessProbe')).toBe(routeOf('ready'));
  });

  it('points the liveness probe at the live handler', () => {
    expect(probePath('livenessProbe')).toBe(routeOf('live'));
  });

  it('gives the two probes different paths', () => {
    // The split is the point, not a detail. `live` answers as long as the event
    // loop turns; `ready` adds the heap check and every dependency indicator and
    // flips to not ready on SIGTERM. Pointing both at the same handler would
    // restart pods for a briefly unreachable database, which only makes an
    // outage longer.
    expect(probePath('readinessProbe')).not.toBe(probePath('livenessProbe'));
  });
});
