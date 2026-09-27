import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  availableModes,
  parseWalkImport,
  type WalkFile,
} from '@portfolio/luna-shopper/shop-map/recorder';
import {
  provideFakeBrowserFacade,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { WalkDb } from '../storage/walk-db';
import { WalkFiles } from '../storage/walk-files';
import { WalkLabState } from '../walk-lab-state';
import { ViewerPage } from './viewer-page';

const FIXTURES = resolve(
  __dirname,
  '../../../../../luna-shopper/shop-map/recorder/src/__fixtures__/walks'
);

function fixture(name: string): WalkFile {
  const dir = join(FIXTURES, name);
  const file = readdirSync(dir).find((f) => f.endsWith('.geojson')) as string;
  const parsed = parseWalkImport(readFileSync(join(dir, file), 'utf8'));
  if (parsed.kind !== 'walk') {
    throw new Error('expected a walk');
  }
  return parsed.walk;
}

async function render(
  walk: WalkFile
): Promise<{ fixture: ComponentFixture<ViewerPage>; page: ViewerPage }> {
  TestBed.configureTestingModule({
    imports: [ViewerPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      provideFakeBrowserFacade(),
      WalkDb,
      WalkFiles,
      WalkLabState,
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: {},
            paramMap: convertToParamMap({ walkId: walk.id }),
          },
        },
      },
    ],
  });
  await TestBed.inject(WalkDb).save(walk);

  const fixture = TestBed.createComponent(ViewerPage);
  const page = fixture.componentInstance;

  // One mode per turn of the event loop: wait for the last one.
  for (
    let i = 0;
    i < 200 && (page.load() !== 'ready' || page.computing());
    i++
  ) {
    await new Promise((r) => setTimeout(r, 5));
  }
  fixture.detectChanges();
  return { fixture, page };
}

describe('ViewerPage', () => {
  it('draws every available mode of a walk and measures each one', async () => {
    const walk = fixture('l-shape');
    const { fixture: f, page } = await render(walk);
    const host: HTMLElement = f.nativeElement;

    const modes = availableModes(walk);
    expect(
      page
        .rows()
        .map((r) => r.mode)
        .sort()
    ).toEqual([...modes].sort());
    expect(page.rows().every((r) => r.state === 'ready')).toBe(true);
    expect(host.querySelectorAll('polyline.track')).toHaveLength(modes.length);

    // The recorder of plan 0001 counts the L's 24 steps and its one turn.
    const own = page.rows().find((r) => r.mode === 'pdr:own:gyro:snap');
    expect(own?.metrics?.steps).toBe(24);
    expect(own?.metrics?.turns).toBe(1);
    expect(host.querySelectorAll('table.metrics tbody tr')).toHaveLength(
      modes.length
    );
  });

  it('turns a mode off from the legend', async () => {
    const { fixture: f, page } = await render(fixture('l-shape'));
    const before = page.lines().length;

    page.toggle('vio');
    f.detectChanges();

    expect(page.lines()).toHaveLength(before - 1);
    expect(page.lines().some((l) => l.id === 'vio')).toBe(false);
  });

  it('lays the draft map over the selected snap mode, and only a snap mode', async () => {
    const { page } = await render(fixture('straight-aisle'));

    page.select('pdr:own:gyro:snap');
    expect(page.rects().length).toBeGreaterThan(0);

    page.select('pdr:own:gyro');
    expect(page.rects()).toEqual([]);
    expect(page.draftNeedsSnap()).toBe(true);
  });

  it('recomputes every track when the step length changes', async () => {
    const { page } = await render(fixture('straight-aisle'));
    const before = page.rows().find((r) => r.mode === 'pdr:own:gyro:snap')
      ?.metrics?.distanceMetres as number;

    page.setStepMetres('1.4');
    for (let i = 0; i < 400 && page.stepMetres() !== 1.4; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // The recompute waits for the typing to stop, then runs a mode per turn.
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < 200 && page.computing(); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const after = page.rows().find((r) => r.mode === 'pdr:own:gyro:snap')
      ?.metrics?.distanceMetres as number;
    expect(after).toBeCloseTo(before * 2, 1);
  });
});
