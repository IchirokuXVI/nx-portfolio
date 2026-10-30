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
  // installs with its app signing key (Play Console, App signing), so production also
  // names that one.
  it('trusts the release key for both flavors and the Play key for production', () => {
    const releaseKey =
      '08:96:62:0D:8C:9E:B8:A9:10:C8:3C:AD:D0:7D:6B:15:F3:2B:0E:42:AB:D0:EC:31:2B:D6:B7:1B:B3:C0:B1:92';
    const playKey =
      'F2:3D:04:67:81:AE:5D:D3:68:F1:A6:AD:40:10:35:DA:67:CF:71:3C:62:4A:09:31:C0:75:97:05:C1:4B:18:6E';

    expect(fingerprintsOf('app.velista.staging')).toEqual([releaseKey]);
    expect([...(fingerprintsOf('app.velista') ?? [])].sort()).toEqual(
      [releaseKey, playKey].sort()
    );
  });
});
