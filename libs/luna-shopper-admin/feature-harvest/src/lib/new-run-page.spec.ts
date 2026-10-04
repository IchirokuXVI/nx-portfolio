import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  applyControlBase,
  controlBaseProperties,
} from './control-base.testing';
import { NewRunPage } from './new-run-page';
import { RunRequestForm } from './run-request-form';

/**
 * The new run page around the run request form: what it does with the request
 * the form hands up (admin plan 0030; admin plan 0044, target 5).
 *
 * The form's own cases are in `run-request-form.spec.ts`. What is here is the
 * page's half: where a started run sends the operator, the refusal a spawn
 * came back with, and saving the form as a preset. These cases were on the
 * runs screen while the form was the first thing on it. The list and its
 * filters are in `runs-page.spec.ts`.
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

/** Where a started run sends the operator. It draws nothing. */
@Component({ selector: 'lib-test-landing', template: '' })
class Landing {}

function spawnRecorder(refusal?: unknown): {
  service: HarvestServiceI;
  spawned: unknown[];
  saved: unknown[];
} {
  const memory = new HarvestMemory();
  const spawned: unknown[] = [];
  const saved: unknown[] = [];

  const service = {
    ...({} as HarvestServiceI),
    createPreset: async (
      supermarketId: string,
      name: string,
      input: unknown
    ) => {
      saved.push({ supermarketId, name, input });
      return memory.createPreset(supermarketId, name, input as never);
    },
    readSource: (id: string) => memory.readSource(id),
    spawnRun: async (input: unknown) => {
      spawned.push(input);
      if (refusal !== undefined) {
        throw refusal;
      }
      return memory.listRuns({}).then((page) => page.items[0]);
    },
  } as unknown as HarvestServiceI;

  return { service, spawned, saved };
}

async function render(refusal?: unknown) {
  const { service, spawned, saved } = spawnRecorder(refusal);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [NewRunPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      // Every address answers, so that the navigation after a start resolves.
      provideRouter([{ path: '**', component: Landing }]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The chain's scopes: the national one the single picker preselects,
        // and two warehouses a Mercadona walk chooses between.
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async () => ({ items: SCOPES, nextCursor: null }),
          }),
        },
      },
      {
        // The chains the picker offers, by name. The form points at one by
        // choosing it here, so a lookup that answered nothing would leave the
        // whole form unreachable.
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

  const fixture = TestBed.createComponent(NewRunPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return {
    fixture: fixture as ComponentFixture<NewRunPage>,
    spawned,
    saved,
  };
}

/** The run request form inside the page. */
function formOf(fixture: ComponentFixture<NewRunPage>): RunRequestForm {
  return fixture.debugElement.query(By.directive(RunRequestForm))
    .componentInstance as RunRequestForm;
}

/** The form, pointed at one chain and given time to read its source row. */
async function chain(fixture: ComponentFixture<NewRunPage>, id: string) {
  formOf(fixture).chooseChain(id);
  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<NewRunPage>): string =>
  fixture.nativeElement.textContent;

/** A page under the Runs tab (admin plan 0044, target 5). */
describe('the new run page, under the Runs tab', () => {
  it('goes back to the Runs tab', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.runsLink).toEqual([
      '/',
      'harvest',
      'runs',
    ]);
    const back: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.page-back');
    expect(back.getAttribute('href')).toBe('/harvest/runs');
  });

  /**
   * A started run is followed on the Runs tab, so the page goes there with
   * the run named, and the tab marks it.
   */
  it('sends a started run to the Runs tab, with the run marked', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    formOf(fixture).submit();
    await drain();
    await drain();

    expect(spawned).toHaveLength(1);
    const run = (await new HarvestMemory().listRuns({})).items[0];
    expect(TestBed.inject(Router).url).toBe(`/harvest/runs?run=${run.id}`);
    expect(fixture.componentInstance.blockedKey()).toBeNull();
  });

  it('stays on the page when the run was refused', async () => {
    const { fixture } = await render(
      new GatewayError({ correlationId: 'ref-1', code: '', status: 500 })
    );
    await chain(fixture, DEZA);

    formOf(fixture).submit();
    await drain();
    await drain();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(fixture.componentInstance.starting()).toBe(false);
  });

  /** Something is already running, which is no switch and has a remedy. */
  it('says a run is already in progress on a 409', async () => {
    const { fixture } = await render(
      new GatewayError({
        correlationId: 'ref-1',
        code: 'conflict',
        status: 409,
      })
    );
    await chain(fixture, DEZA);

    formOf(fixture).submit();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.blockedKey()).toBe(
      'harvest.runs.start.alreadyRunning'
    );
  });
});

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
 * The controls the form is made of (plan 0018, section 2).
 *
 * The rule is in `apps/luna-shopper-admin/src/styles.scss`, which a `TestBed`
 * does not load, so the spec puts it in front of the component the way a
 * browser puts it in front of an operator. It is read out of that file rather
 * than written here, since a copy would pass with the rule deleted.
 */
describe('the new run page, and its controls', () => {
  let remove: () => void;

  beforeEach(() => {
    remove = applyControlBase();
  });

  afterEach(() => remove());

  /**
   * The button that starts a run. `.primary` is a modifier and stays on the
   * form, so what it says is which button this is; the padding and the corners
   * come from the base like every other control's.
   */
  it('draws the start button from the base and its own modifier', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    const start: HTMLButtonElement =
      fixture.nativeElement.querySelector('button.primary');

    expect(start).not.toBeNull();
    expect(getComputedStyle(start).getPropertyValue('min-block-size')).toBe(
      'var(--admin-control)'
    );
    expect(controlBaseProperties()).toContain('padding');
    expect(controlBaseProperties()).toContain('border-radius');
  });
});

/** Save as preset (admin plan 0030, section 4). */
describe('the new run page, saving the form as a preset', () => {
  it('is disabled until the form could start', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    expect(fixture.componentInstance.canSave()).toBe(false);
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-save-preset]');
    expect(button.disabled).toBe(true);

    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();
    expect(fixture.componentInstance.canSave()).toBe(true);
    expect(button.disabled).toBe(false);
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

  /**
   * The presets are a panel of the Runs tab now, so the notice links there,
   * with the chain to open the panel on and the preset to mark.
   */
  it('links the saved preset to the Runs tab, on its chain', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;
    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    page.openSave();
    page.onSaveNameChange('Cordoba only');
    await page.saveAsPreset();
    fixture.detectChanges();

    const saved = page.savedPreset();
    expect(saved?.query['chain']).toBe(MERCADONA);
    expect(saved?.query['preset']).toEqual(expect.any(String));

    const link: HTMLAnchorElement =
      fixture.nativeElement.querySelector('.notice a');
    expect(link.getAttribute('href')).toBe(
      `/harvest/runs?chain=${MERCADONA}&preset=${saved?.query['preset']}`
    );
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

  it('opens a modal dialog, and Escape closes it', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;
    formOf(fixture).toggleScope(CORDOBA, ticked(true));
    fixture.detectChanges();

    page.openSave();
    fixture.detectChanges();

    const dialog: HTMLElement =
      fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(page.saveOpen()).toBe(false);
  });
});
