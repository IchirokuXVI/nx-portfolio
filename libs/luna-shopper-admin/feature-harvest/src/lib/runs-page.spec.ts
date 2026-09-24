import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_WEEKLY_PRESET,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  applyControlBase,
  controlBaseProperties,
} from './control-base.testing';
import { RunRequestForm } from './run-request-form';
import { RunsPage } from './runs-page';

/**
 * The runs page around the run request form: what it does with the request
 * the form hands up (admin plan 0030).
 *
 * The form's own cases are in `run-request-form.spec.ts`. What is here is the
 * page's half: the refusal a spawn came back with, the filters over the list,
 * saving the form as a preset, and the preset a run came from.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';
const NATIONAL = 'scope-national';
const CORDOBA = 'scope-4661';
const CORUNA = 'scope-4804';

/**
 * What the chain's scopes look like, which is what both scope controls read.
 *
 * `priority` is what the adapter's band is read against and `externalKey` is
 * the warehouse a walk fetches (backend plan 0108), so those are the two fields
 * every case here varies. The numbers are `DEFAULT_SCOPE_PRIORITY`'s.
 */
const SCOPES = [
  {
    id: NATIONAL,
    kind: 'NATIONAL',
    externalKey: null,
    label: null,
    priority: 1000,
  },
  {
    id: CORDOBA,
    kind: 'LOCAL_AREA',
    externalKey: '4661',
    label: null,
    priority: 200,
  },
  {
    id: CORUNA,
    kind: 'LOCAL_AREA',
    externalKey: '4804',
    label: { en: 'A Coruna' },
    priority: 200,
  },
];

/** What the chain picker finds, whatever is typed into it. */
const CHAINS = [
  { id: MERCADONA, title: 'Mercadona' },
  { id: DEZA, title: 'Deza' },
];

/** A checkbox change, as the template hands one to `toggleScope`. */
const ticked = (checked: boolean) =>
  ({ target: { checked } }) as unknown as Event;

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

/**
 * The adapter a chain is fetched with, overriding the seed.
 *
 * The form draws itself from what the adapter can tell us (backend plan 0103,
 * section 4), so a spec per capability row needs a chain per adapter. The seed
 * has two, and adding four more chains to it would be seeding a directory to
 * test a form.
 */
/** What a spec changes about the harvester behind the page. */
interface RenderOptions {
  /** The presets read answers none, so every preset a run names is gone. */
  readonly presetsGone?: boolean;
}

function spawnRecorder(
  refusal?: unknown,
  adapters: Readonly<Record<string, string>> = {},
  options: RenderOptions = {}
): {
  service: HarvestServiceI;
  spawned: unknown[];
  listed: unknown[];
  saved: unknown[];
} {
  const memory = new HarvestMemory();
  const spawned: unknown[] = [];
  const listed: unknown[] = [];
  const saved: unknown[] = [];

  const service = {
    ...({} as HarvestServiceI),
    listRuns: (query: never) => {
      listed.push(query);
      return memory.listRuns(query);
    },
    listPresets: async (supermarketId?: string, cursor?: string) =>
      options.presetsGone
        ? { items: [], nextCursor: null }
        : memory.listPresets(supermarketId, cursor),
    createPreset: async (
      supermarketId: string,
      name: string,
      input: unknown
    ) => {
      saved.push({ supermarketId, name, input });
      return memory.createPreset(supermarketId, name, input as never);
    },
    readSource: async (id: string) => {
      const source = await memory.readSource(id);
      const adapterKey = adapters[id];
      return adapterKey === undefined
        ? source
        : { ...source, adapterKey: adapterKey as typeof source.adapterKey };
    },
    spawnRun: async (input: unknown) => {
      spawned.push(input);
      if (refusal !== undefined) {
        throw refusal;
      }
      return memory.listRuns({}).then((page) => page.items[0]);
    },
  } as unknown as HarvestServiceI;

  return { service, spawned, listed, saved };
}

async function render(
  refusal?: unknown,
  adapters: Readonly<Record<string, string>> = {},
  options: RenderOptions = {}
) {
  const { service, spawned, listed, saved } = spawnRecorder(
    refusal,
    adapters,
    options
  );
  const scopeReads: unknown[] = [];

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The chain's scopes: the national one the single picker preselects,
        // and two warehouses a Mercadona walk chooses between.
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async (query: unknown) => {
              scopeReads.push(query);
              return { items: SCOPES, nextCursor: null };
            },
          }),
        },
      },
      {
        // The chains the picker offers, by name. The form points at one by
        // choosing it here now, so a lookup that answered nothing would leave
        // the whole start form unreachable.
        provide: ResourceReferences,
        useValue: {
          search: async () => CHAINS,
          resolve: async (_resource: string, id: string) =>
            CHAINS.find((chain) => chain.id === id) ?? null,
        },
      },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunsPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return {
    fixture: fixture as ComponentFixture<RunsPage>,
    spawned,
    listed,
    saved,
    scopeReads,
  };
}

/** The run request form inside the page. */
function formOf(fixture: ComponentFixture<RunsPage>): RunRequestForm {
  return fixture.debugElement.query(By.directive(RunRequestForm))
    .componentInstance as RunRequestForm;
}

/** The form, pointed at one chain and given time to read its source row. */
async function chain(fixture: ComponentFixture<RunsPage>, id: string) {
  formOf(fixture).chooseChain(id);
  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<RunsPage>): string =>
  fixture.nativeElement.textContent;

/**
 * What the server said, on the screen that asked (the reported defect).
 *
 * A spawn is refused for a chain with no source row, for a source switched off
 * and for a walk with no scope, and each of those is a sentence naming the row
 * to change. It reaches this app in the envelope's `detail`, and the screen used
 * to answer every one of them with "the server did not say why".
 */
describe('the run form, a refusal the server explained', () => {
  const refusal = (init: {
    code: string;
    status: number;
    detail?: string;
    fieldErrors?: Record<string, readonly string[]>;
  }) => new GatewayError({ correlationId: 'ref-1', ...init });

  it('draws the sentence the server sent', async () => {
    const { fixture } = await render(
      refusal({
        code: 'validation_failed',
        status: 400,
        detail: 'That source is disabled. Enable it with supermarketSource.',
      })
    );
    await chain(fixture, DEZA);

    formOf(fixture).submit();
    await drain();
    fixture.detectChanges();

    expect(text(fixture)).toContain('That source is disabled');
    expect(fixture.componentInstance.blockedKey()).toBe(
      'harvest.runs.start.refused'
    );
    expect(text(fixture)).not.toContain('harvest.runs.start.failed');
  });

  /** A gateway DTO refusal explains itself field by field instead. */
  it('draws every field message a refusal carried', async () => {
    const { fixture } = await render(
      refusal({
        code: 'validation_failed',
        status: 400,
        detail: 'Bad Request',
        fieldErrors: { priceScopeId: ['priceScopeId must be a UUID'] },
      })
    );
    await chain(fixture, DEZA);

    formOf(fixture).submit();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.blockedDetails()).toEqual([
      'priceScopeId must be a UUID',
    ]);
    expect(text(fixture)).not.toContain('Bad Request');
  });

  /**
   * The server is the authority on every copy rule the form does not check
   * (admin plan 0029, constraints), and its refusal names the scope.
   */
  it('draws a copy refusal that names a scope', async () => {
    const { fixture } = await render(
      refusal({
        code: 'validation_failed',
        status: 400,
        detail:
          'The price scope scope-store-9 does not belong to this chain, so it ' +
          'cannot receive a copy of its prices.',
      })
    );
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;
    const form = formOf(fixture);
    form.toggleScope(CORUNA, ticked(true));
    form.changeCopies(CORUNA, ['scope-store-9']);

    form.submit();
    await drain();
    fixture.detectChanges();

    expect(text(fixture)).toContain('The price scope scope-store-9');
    expect(page.blockedKey()).toBe('harvest.runs.start.refused');
  });

  /** A failure that really did arrive with nothing in it still says so. */
  it('says the server explained nothing only when it did not', async () => {
    const { fixture } = await render(refusal({ code: '', status: 500 }));
    await chain(fixture, DEZA);

    formOf(fixture).submit();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.blockedDetails()).toEqual([]);
    expect(fixture.componentInstance.blockedKey()).toBe(
      'harvest.runs.start.failed'
    );
  });
});

/**
 * The reverted filter, which had the chain field's defect.
 *
 * Its handler sat beside a banana box too, so the read went out with the choice
 * the operator had just moved away from and the list answered for the previous
 * one.
 */
describe('the runs list, and the filter over it', () => {
  it('reads with the filter just chosen', async () => {
    const { fixture, listed } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="reverted"]'
    );

    select.value = 'reverted';
    select.dispatchEvent(new Event('change'));
    await drain();

    expect(fixture.componentInstance.reverted()).toBe('reverted');
    expect(listed.at(-1)).toEqual({ limit: 20, reverted: true });
  });

  /** Admin plan 0034, section 4: one mode at a time, or all of them. */
  it('filters by mode, and sends none for any mode', async () => {
    const { fixture, listed } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="modeFilter"]'
    );

    const offered = [...select.querySelectorAll('option')].map(
      (option) => option.value
    );
    expect(offered).toEqual([
      '',
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);

    select.value = 'STORE_DISCOVERY';
    select.dispatchEvent(new Event('change'));
    await drain();
    expect(listed.at(-1)).toEqual({ limit: 20, mode: 'STORE_DISCOVERY' });

    select.value = '';
    select.dispatchEvent(new Event('change'));
    await drain();
    expect(listed.at(-1)).toEqual({ limit: 20 });
  });
});

/**
 * The controls the form is made of (plan 0018, section 2).
 *
 * This screen was the report: "default select styles", and buttons that "aren't
 * styled properly". It wrote no control styles of its own and there was no rule
 * anywhere that gave it any, so the reverted filter was a browser `<select>` and
 * the one button that starts a harvest run had an accent background, no padding
 * and square corners.
 *
 * The rule is in `apps/luna-shopper-admin/src/styles.scss` now, which a
 * `TestBed` does not load, so the spec puts it in front of the component the way
 * a browser puts it in front of an operator. It is read out of that file rather
 * than written here, since a copy would pass with the rule deleted.
 */
describe('the runs screen, and its controls', () => {
  let remove: () => void;

  beforeEach(() => {
    remove = applyControlBase();
  });

  afterEach(() => remove());

  it('draws the reverted filter as a control and not as browser chrome', async () => {
    const { fixture } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="reverted"]'
    );

    expect(select).not.toBeNull();
    expect(getComputedStyle(select).getPropertyValue('min-block-size')).toBe(
      '2.75rem'
    );
  });

  /**
   * The button that starts a run. `.primary` is a modifier and stays on this
   * screen, so what it says is which button this is; the padding and the corners
   * come from the base like every other control's.
   */
  it('draws the start button from the base and its own modifier', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    const start: HTMLButtonElement =
      fixture.nativeElement.querySelector('button.primary');

    expect(start).not.toBeNull();
    expect(getComputedStyle(start).getPropertyValue('min-block-size')).toBe(
      '2.75rem'
    );
    expect(controlBaseProperties()).toContain('padding');
    expect(controlBaseProperties()).toContain('border-radius');
  });
});

/** Save as preset (admin plan 0030, section 4). */
describe('the runs page, saving the form as a preset', () => {
  it('is disabled until the form could start', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    expect(fixture.componentInstance.canSave()).toBe(false);

    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();
    expect(fixture.componentInstance.canSave()).toBe(true);
  });

  it('sends the form request, without its chain, and the name', async () => {
    const { fixture, saved } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;
    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    page.openSave();
    page.onSaveNameChange('Cordoba only');
    await page.saveAsPreset();
    fixture.detectChanges();

    expect(saved).toEqual([
      {
        supermarketId: MERCADONA,
        name: 'Cordoba only',
        input: {
          mode: 'CATALOG_DISCOVERY',
          priceScopeIds: [CORDOBA],
          writes: 'PRICES_AND_AVAILABILITY',
          details: 'NEW',
        },
      },
    ]);
    expect(page.saveOpen()).toBe(false);
    expect(page.savedPreset()?.name).toBe('Cordoba only');
    expect(text(fixture)).toContain('harvest.presets.saveAs.open');
  });

  it('shows a duplicate name under the field and keeps the dialog open', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;
    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    page.openSave();
    page.onSaveNameChange('weekly WAREHOUSES');
    await page.saveAsPreset();
    fixture.detectChanges();

    expect(page.saveOpen()).toBe(true);
    expect(page.saveNameTaken()).toBe(true);
    expect(text(fixture)).toContain('harvest.presets.nameTaken');
  });
});

/** The preset a run came from, and the filter by it (section 5). */
describe('the runs list, and the preset a run came from', () => {
  it('names the preset a run was started from', async () => {
    const { fixture } = await render();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.presetOf('run-catalog-completed')).toEqual(
      { kind: 'named', name: 'Weekly warehouses' }
    );
    expect(text(fixture)).toContain('harvest.runs.row.preset');
    expect(fixture.componentInstance.presetOf('run-store-aborted')).toBeNull();
  });

  it('says a preset that no longer exists is deleted', async () => {
    // The run still names the seeded preset, which the chain no longer holds.
    const { fixture } = await render(undefined, {}, { presetsGone: true });
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.presetOf('run-catalog-completed')).toEqual(
      { kind: 'deleted' }
    );
    expect(text(fixture)).toContain('harvest.runs.row.deletedPreset');
  });

  it('filters by preset', async () => {
    const { fixture, listed } = await render();
    await drain();
    fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="preset"]'
    );

    select.value = MERCADONA_WEEKLY_PRESET;
    select.dispatchEvent(new Event('change'));
    await drain();

    expect(listed.at(-1)).toEqual({
      limit: 20,
      presetId: MERCADONA_WEEKLY_PRESET,
    });
  });
});
