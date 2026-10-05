import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DASHBOARD_SERVICE,
  DashboardStore,
  HARVEST_RUN_SEED,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import type { HarvestRun } from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { HarvestHeader } from './harvest-header';
import { HarvestStatus } from './harvest-status';

/**
 * The header of every Harvest tab (admin plan 0044, targets 1 and 3): the
 * section's title, and the run in progress on every tab.
 */

const RUNNING = HARVEST_RUN_SEED.find(
  (run) => run.status === 'RUNNING'
) as HarvestRun;

@Component({ selector: 'lib-test-landing', template: '' })
class Landing {}

/** A page that gives the header a chip and an action, as the Runs tab does. */
@Component({
  selector: 'lib-test-host',
  imports: [HarvestHeader],
  template: `
    <lib-harvest-header>
      <span pageChip data-own-chip>state</span>
      <button pageAction type="button" data-own-action>act</button>
    </lib-harvest-header>
  `,
})
class Host {}

function dashboard(running: HarvestRun | null): DashboardDocument {
  return {
    measuredAt: '2026-09-03T10:00:00.000Z',
    harvest: {
      runs: { byStatus: [], inWindow: 0 },
      running,
      recent: [],
      queues: { entries: [], places: 0, shops: [], brands: 0 },
      sources: { total: 2, enabled: 0 },
    },
  } as unknown as DashboardDocument;
}

const drain = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }
};

interface World {
  readonly running?: HarvestRun | null;
  readonly compact?: boolean;
}

async function render<T>(component: new () => T, world: World = {}) {
  const compact = signal(world.compact ?? false);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [component, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: Landing }]),
      provideLocationMocks(),
      {
        provide: DASHBOARD_SERVICE,
        useValue: {
          read: async () =>
            dashboard(world.running === undefined ? RUNNING : world.running),
        },
      },
      { provide: Viewport, useValue: { compact, split: signal(false) } },
      {
        provide: ResourceReferences,
        useValue: {
          search: async () => [],
          resolve: async (_resource: string, id: string) => ({
            id,
            title: 'Mercadona',
          }),
        },
      },
    ],
  }).compileComponents();

  const status = TestBed.inject(HarvestStatus);
  const follow = jest.spyOn(status, 'followRuns');

  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await drain();
  // The run arrived: this pass asks for its chain's name.
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return { fixture: fixture as ComponentFixture<T>, follow, compact };
}

const one = (fixture: ComponentFixture<unknown>, selector: string) =>
  fixture.nativeElement.querySelector(selector) as HTMLElement | null;

afterEach(() => TestBed.inject(DashboardStore).stop());

describe('HarvestHeader', () => {
  it('is titled with the section, as the one heading of the page', async () => {
    const { fixture } = await render(HarvestHeader, { running: null });

    const headings = fixture.nativeElement.querySelectorAll('h1');
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toContain('shell.sections.harvest');
  });

  /** The header says nothing about runs on a quiet day. */
  it('draws nothing about a run when none is in progress', async () => {
    const { fixture } = await render(HarvestHeader, { running: null });

    expect(one(fixture, '[data-running]')).toBeNull();
  });

  it('draws nothing about a run that has ended', async () => {
    const { fixture } = await render(HarvestHeader, {
      running: { ...RUNNING, status: 'COMPLETED' },
    });

    expect(one(fixture, '[data-running]')).toBeNull();
  });

  describe('with a run in progress, on a wide screen', () => {
    it('draws the run inside the header, and no line under it', async () => {
      const { fixture } = await render(HarvestHeader);

      expect(
        one(fixture, 'lib-page-header [data-running="header"]')
      ).not.toBeNull();
      expect(one(fixture, '[data-running="line"]')).toBeNull();
    });

    it('says the state, the chain and the kind of run, and how far it is', async () => {
      const { fixture } = await render(HarvestHeader);
      const run = one(fixture, '[data-running="header"]');

      expect(run?.querySelector('.chip')?.textContent).toContain(
        'harvest.status.RUNNING'
      );
      expect(run?.querySelector('.what')?.textContent).toContain('Mercadona');
      expect(run?.querySelector('.what')?.textContent).toContain(
        `harvest.mode.${RUNNING.mode}`
      );
      expect(run?.querySelector('.count')?.textContent).toContain(
        'harvest.run.progress.'
      );
    });

    it('is a link to the run', async () => {
      const { fixture } = await render(HarvestHeader);

      expect(
        one(fixture, '[data-running="header"]')?.getAttribute('href')
      ).toBe(`/harvest/runs/${RUNNING.id}`);
    });

    it('is named for a screen reader', async () => {
      const { fixture } = await render(HarvestHeader);

      expect(
        one(fixture, '[data-running="header"]')?.getAttribute('aria-label')
      ).toBe('harvest.running.open');
    });
  });

  describe('with a run in progress, on a phone', () => {
    it('draws one line under the header, and nothing inside it', async () => {
      const { fixture } = await render(HarvestHeader, { compact: true });

      const line = one(fixture, '[data-running="line"]');
      expect(line).not.toBeNull();
      expect(line?.closest('lib-page-header')).toBeNull();
      expect(one(fixture, '[data-running="header"]')).toBeNull();
      expect(line?.getAttribute('href')).toBe(`/harvest/runs/${RUNNING.id}`);
    });

    it('moves the line when the screen changes width', async () => {
      const { fixture, compact } = await render(HarvestHeader, {
        compact: true,
      });

      compact.set(false);
      fixture.detectChanges();

      expect(one(fixture, '[data-running="line"]')).toBeNull();
      expect(one(fixture, '[data-running="header"]')).not.toBeNull();
    });
  });

  /** While a tab is open the dashboard is read at the cadence of a run. */
  describe('the cadence of the read', () => {
    it('follows the run while the header is on screen', async () => {
      const { follow } = await render(HarvestHeader);

      expect(follow).toHaveBeenCalledWith(true);
      expect(follow).not.toHaveBeenCalledWith(false);
    });

    it('gives the slower cadence back when the header goes', async () => {
      const { fixture, follow } = await render(HarvestHeader);

      fixture.destroy();

      expect(follow).toHaveBeenLastCalledWith(false);
    });
  });

  /** A tab gives the header its own chip and its own actions. */
  describe('what a page projects into it', () => {
    it('passes a chip and an action on to the page header', async () => {
      const { fixture } = await render(Host, { running: null });

      expect(
        one(fixture, 'lib-page-header .page-chips [data-own-chip]')
      ).not.toBeNull();
      expect(
        one(fixture, 'lib-page-header .page-actions [data-own-action]')
      ).not.toBeNull();
    });

    it('draws the run beside the page’s own chip', async () => {
      const { fixture } = await render(Host);

      expect(
        one(fixture, 'lib-page-header .page-chips [data-own-chip]')
      ).not.toBeNull();
      expect(
        one(fixture, 'lib-page-header .page-chips [data-running="header"]')
      ).not.toBeNull();
    });
  });
});
