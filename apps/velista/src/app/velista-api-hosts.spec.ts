import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_LUNA_GATEWAY_URL,
  DEFAULT_LUNA_REALTIME_URL,
} from '../../webpack.prod.config';

/**
 * The baked backend hosts, asserted against the chart that routes them (plan
 * 0014, section 3.4).
 *
 * `environment.prod.ts` shipped `api.ichirokuxvi.com` for BOTH URLs, while
 * `values.yaml` routes `luna-shopper-backend-realtime` on `rt.`. Every socket and
 * SSE connection was therefore aimed at the REST gateway, which does not serve
 * them — wrong in production, not only in staging, and invisible because two
 * files had to agree and nothing checked that they did.
 *
 * This is that check. It fails the day someone renames a host, which is the only
 * day it matters.
 */
describe('velista production API hosts', () => {
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
    resolve(workspaceRoot(), 'k8s/helm/values.yaml'),
    'utf8'
  );
  const production = readFileSync(
    resolve(workspaceRoot(), 'k8s/helm/values.production.yaml'),
    'utf8'
  );

  /** The domain the production cluster serves, from its environment values file. */
  function baseDomain(): string {
    const match = /^baseDomain:\s*(\S+)\s*$/m.exec(production);
    if (!match) throw new Error('no baseDomain in values.production.yaml');
    return match[1];
  }

  /**
   * The `hostPrefix` the chart routes one backend service on. Since plan 0002 the
   * services list is environment agnostic and carries a prefix under
   * `baseDomain` rather than a full hostname, so the production host is the two
   * composed.
   */
  function hostOf(serviceName: string): string {
    const entry = new RegExp(
      `- name: ${serviceName}\\b[\\s\\S]*?hostPrefix: (\\S+)`
    ).exec(chart);
    if (!entry) throw new Error(`no hostPrefix for ${serviceName} in values.yaml`);
    return `https://${entry[1]}.${baseDomain()}`;
  }

  it('points the gateway URL at the routed REST service', () => {
    expect(DEFAULT_LUNA_GATEWAY_URL).toBe(hostOf('luna-shopper-backend-gateway'));
  });

  it('points the realtime URL at the routed realtime service', () => {
    expect(DEFAULT_LUNA_REALTIME_URL).toBe(
      hostOf('luna-shopper-backend-realtime')
    );
  });

  it('gives the two services different hosts', () => {
    // The regression this file exists for: both constants naming `api.`.
    expect(DEFAULT_LUNA_GATEWAY_URL).not.toBe(DEFAULT_LUNA_REALTIME_URL);
  });

  it('is allowed as a CORS origin by the production config', () => {
    // The other half of the same agreement: the gateway only accepts an explicit
    // list of origins, so velista's own host has to be on it or every request is
    // blocked (values.production.yaml, corsOrigins).
    const origins = /^\s*corsOrigins:\s*(\S+)\s*$/m.exec(production);
    expect(origins).not.toBeNull();
    expect(origins?.[1].split(',')).toContain(
      `https://velista.${baseDomain()}`
    );
  });
});
