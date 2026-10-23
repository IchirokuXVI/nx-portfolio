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

  it('hands every URL to an Android app signed with one SHA-256 certificate', () => {
    for (const statement of statements) {
      expect(statement.relation).toEqual([
        'delegate_permission/common.handle_all_urls',
      ]);
      expect(statement.target.namespace).toBe('android_app');
      expect(statement.target.sha256_cert_fingerprints).toHaveLength(1);
      expect(statement.target.sha256_cert_fingerprints[0]).toMatch(
        /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/
      );
    }

    const fingerprints = new Set(
      statements.map((s) => s.target.sha256_cert_fingerprints[0])
    );
    expect(fingerprints.size).toBe(1);
  });
});
