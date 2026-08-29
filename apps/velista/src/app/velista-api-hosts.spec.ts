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
      if (parent === dir)
        throw new Error('could not locate the workspace root');
      dir = parent;
    }
    return dir;
  }

  /**
   * Read a values file with its line endings normalised. A Windows checkout hands
   * back CRLF, and a multi line pattern anchored on `\n` (the `hostOverrides` block
   * below) then matches nothing at all, which fails as a wrong hostname rather than
   * as a parse error.
   */
  function readValues(path: string): string {
    return readFileSync(resolve(workspaceRoot(), path), 'utf8').replace(
      /\r\n/g,
      '\n'
    );
  }

  const chart = readValues('k8s/helm/values.yaml');
  const production = readValues('k8s/helm/values.production.yaml');

  /** The domain the production cluster serves, from its environment values file. */
  function baseDomain(): string {
    const match = /^baseDomain:\s*(\S+)\s*$/m.exec(production);
    if (!match) throw new Error('no baseDomain in values.production.yaml');
    return match[1];
  }

  /**
   * The `hostOverrides` block of the production values file, as a map. It names the
   * entries that do not sit under `baseDomain` at all, which since velista got its
   * own domain is velista and both of its backend services.
   */
  function hostOverrides(): Record<string, string> {
    const block = /^hostOverrides:\n((?:[ \t]+\S[^\n]*\n?)+)/m.exec(production);
    if (!block) return {};
    const map: Record<string, string> = {};
    for (const line of block[1].split('\n')) {
      const entry = /^\s+([\w-]+):\s*(\S+)\s*$/.exec(line);
      if (entry) map[entry[1]] = entry[2];
    }
    return map;
  }

  /**
   * The host the chart routes one `apps` / `services` entry on, by the same
   * precedence the `charts.host` helper uses: an environment override wins,
   * otherwise the entry's `hostPrefix` composed under `baseDomain`.
   *
   * Both halves are asserted rather than only the second, because the override is
   * exactly where a rename now happens: the day one of these three names moves
   * domains again, it moves in values.production.yaml alone.
   */
  function hostOf(entryName: string): string {
    const override = hostOverrides()[entryName];
    if (override) return `https://${override}`;
    const entry = new RegExp(
      `- name: ${entryName}\\b[\\s\\S]*?hostPrefix: (\\S+)`
    ).exec(chart);
    if (!entry)
      throw new Error(`no hostPrefix for ${entryName} in values.yaml`);
    return `https://${entry[1]}.${baseDomain()}`;
  }

  it('points the gateway URL at the routed REST service', () => {
    expect(DEFAULT_LUNA_GATEWAY_URL).toBe(
      hostOf('luna-shopper-backend-gateway')
    );
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
    expect(origins?.[1].split(',')).toContain(hostOf('velista'));
  });

  it('serves the app and its backend from the same domain', () => {
    // Not a style preference. velista is installable, so it is identified by its
    // origin, and the whole point of moving it off the portfolio's domain was that
    // the thing it talks to came too. A backend left behind still works, but it
    // means one more name on the certificate, in CORS and in the Google console.
    const domainOf = (url: string) =>
      new URL(url).hostname.split('.').slice(-2).join('.');
    expect(domainOf(DEFAULT_LUNA_GATEWAY_URL)).toBe(
      domainOf(hostOf('velista'))
    );
    expect(domainOf(DEFAULT_LUNA_REALTIME_URL)).toBe(
      domainOf(hostOf('velista'))
    );
  });
});
