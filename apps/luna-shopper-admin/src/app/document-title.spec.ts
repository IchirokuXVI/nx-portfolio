import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { DocumentTitle } from './document-title';

/**
 * The environment name in the document title (plan 0001, section 6), which is where
 * it survives being taken out of context: the browser tab, and any screenshot pasted
 * into a bug report.
 *
 * The translator double returns the key and does not interpolate, which is why the
 * title is composed from two keys rather than one interpolated string: it stays
 * assertable here, and the assertions read as key names rather than as copy.
 */
async function titleFor(deployment: Deployment | null | undefined) {
  TestBed.resetTestingModule();

  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: DeploymentStore,
        useValue: { deployment: signal(deployment).asReadonly() },
      },
      DocumentTitle,
    ],
  });

  TestBed.inject(Title).setTitle('before');
  TestBed.inject(DocumentTitle);
  // The service waits on `loaded$` before it writes anything. Drain microtasks
  // rather than calling `whenStable`, which hangs in a zoneless spec.
  await Promise.resolve();
  await Promise.resolve();
  TestBed.tick();

  return TestBed.inject(Title).getTitle();
}

describe('DocumentTitle', () => {
  it.each<Deployment>(['production', 'staging', 'development'])(
    'puts the %s deployment in the tab',
    async (deployment) => {
      expect(await titleFor(deployment)).toBe(
        `environment.${deployment} · app.name`
      );
    }
  );

  it('says unknown when the deployment could not be established', async () => {
    expect(await titleFor(null)).toBe('environment.unknown · app.name');
  });

  /**
   * A cold load must not flash a warning it then withdraws. Until the read settles
   * the static title from `index.html` stands, because "unknown" for the moment
   * before the answer arrives is noise rather than information.
   */
  it('leaves the title alone while the deployment is still being read', async () => {
    expect(await titleFor(undefined)).toBe('before');
  });
});
