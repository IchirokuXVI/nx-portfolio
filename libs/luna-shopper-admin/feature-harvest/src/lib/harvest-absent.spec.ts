import { provideLocationMocks } from '@angular/common/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  type DeploymentServiceI,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  type HarvestServiceI,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { ItemRefsQueuePage } from './item-refs-queue-page';
import { PlacesQueuePage } from './places-queue-page';
import { RunsPage } from './runs-page';
import { SourcesPage } from './sources-page';

/**
 * Section 4 and section 7's fourth test: **with the harvester absent, every
 * screen says so rather than rendering empty.**
 *
 * The harvester is switched off in production and in staging on purpose, and
 * nothing renders in either cluster, so every read here fails in exactly the two
 * environments most people ever open this app in. An empty list would say "there
 * have been no runs", which is a different claim and a false one, and it is the
 * kind of thing that reads as a bug forever.
 *
 * Zoneless, so the load promise is drained by hand rather than with
 * `whenStable`, which hangs. The translator double answers with the key, which
 * is why the assertions read as key names.
 */

const drain = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

/** A harvester that answers nothing at all, which is what absence looks like. */
function silent(): HarvestServiceI {
  const refuse = async (): Promise<never> => {
    throw new GatewayError({ code: '', status: 0, correlationId: '' });
  };

  return {
    spawnRun: refuse,
    listRuns: refuse,
    readRun: refuse,
    abortRun: refuse,
    revertRun: refuse,
    listPlaces: refuse,
    placeGroups: refuse,
    importPlace: refuse,
    rejectPlace: refuse,
    listEntries: refuse,
    createItemFromEntry: refuse,
    listItemRefs: refuse,
    listUnresolvedItemRefs: refuse,
    setManualItemRef: refuse,
    confirmItemRef: refuse,
    rejectItemRef: refuse,
    listSources: refuse,
    readSource: refuse,
    upsertSource: refuse,
    setSourceEnabled: refuse,
  };
}

async function render<T>(
  component: new (...args: never[]) => T,
  deployment: Deployment
): Promise<ComponentFixture<T>> {
  const deployments: DeploymentServiceI = {
    read: async () => ({ deployment, devAutologin: false }),
  };

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [component as never, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: silent() },
      { provide: DEPLOYMENT_SERVICE, useValue: deployments },
      DeploymentStore,
    ],
  }).compileComponents();

  // The environment read decides whether an absence is expected, so it has to
  // have settled before the screen is judged on what it drew.
  await TestBed.inject(DeploymentStore).load();

  const fixture = TestBed.createComponent(component as never);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return fixture as ComponentFixture<T>;
}

const notice = (fixture: ComponentFixture<unknown>) =>
  fixture.nativeElement.querySelector('lib-harvest-notice');

const screens = [
  ['runs', RunsPage],
  ['discovered places', PlacesQueuePage],
  ['item refs', ItemRefsQueuePage],
  ['chain sources', SourcesPage],
] as const;

describe('with the harvester absent', () => {
  it.each(screens)('%s says the service is not deployed', async (_, page) => {
    const fixture = await render(page, 'production');
    const shown = notice(fixture);

    expect(shown).not.toBeNull();
    expect(shown.textContent).toContain('harvest.absent.heading');
    // Never the empty state, which would claim nothing has ever happened.
    expect(fixture.nativeElement.textContent).not.toContain('.empty');
  });

  it.each(screens)(
    '%s offers no retry for an expected absence',
    async (_, page) => {
      const fixture = await render(page, 'production');

      // There is nothing to retry: no Deployment, no Service, no database. A
      // button that invited an operator to try again would be inviting them to
      // fail again.
      expect(notice(fixture).querySelector('button')).toBeNull();
    }
  );

  it('says the same in staging, where the chart also excludes it', async () => {
    const fixture = await render(RunsPage, 'staging');

    expect(notice(fixture).textContent).toContain('harvest.absent.heading');
  });
});

describe('with the harvester expected and silent', () => {
  /**
   * A failure in an environment that should be running it is a failure, not an
   * expected absence, and it says so differently and offers the retry.
   */
  it.each(screens)('%s says the harvester did not answer', async (_, page) => {
    const fixture = await render(page, 'development');
    const shown = notice(fixture);

    expect(shown).not.toBeNull();
    expect(shown.textContent).toContain('harvest.down.heading');
    expect(shown.querySelector('button')).not.toBeNull();
  });
});
