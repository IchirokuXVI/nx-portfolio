import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The App Links statement both Android flavors are verified against (plan 0167, D5).
 *
 * One image serves staging and production, so the one file names both package names:
 * `appId` in `capacitor.config.ts` and that id with the staging flavor's
 * `applicationIdSuffix`. They are literals here and not read from those files, which
 * are outside this project's test inputs (`namedInputs` in `project.json`) so that an
 * Android change never invalidates the web build's cache.
 */
describe('velista assetlinks.json', () => {
  interface Statement {
    relation: string[];
    target: {
      namespace: string;
      package_name: string;
      sha256_cert_fingerprints: string[];
    };
  }

  const statements = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../public/.well-known/assetlinks.json'),
      'utf8'
    )
  ) as Statement[];

  it('names the production and the staging package', () => {
    const packages = statements.map((s) => s.target.package_name).sort();
    expect(packages).toEqual(['app.velista', 'app.velista.staging']);
  });

  const fingerprintsOf = (packageName: string) =>
    statements.find((s) => s.target.package_name === packageName)?.target
      .sha256_cert_fingerprints;

  it('hands every URL to an Android app, by SHA-256 certificate', () => {
    for (const statement of statements) {
      expect(statement.relation).toEqual([
        'delegate_permission/common.handle_all_urls',
      ]);
      expect(statement.target.namespace).toBe('android_app');
      for (const fingerprint of statement.target.sha256_cert_fingerprints) {
        expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      }
    }
  });

  // Our release key signs both flavors' own builds. Google Play re-signs what it
  // installs with its app signing key, so production also names that one.
  it('trusts the release key for both flavors and the Play key for production', () => {
    const staging = fingerprintsOf('app.velista.staging') ?? [];
    const production = fingerprintsOf('app.velista') ?? [];

    expect(staging).toHaveLength(1);
    expect(production).toHaveLength(2);
    expect(production[0]).toBe(staging[0]);
    expect(production[1]).not.toBe(staging[0]);
  });
});
