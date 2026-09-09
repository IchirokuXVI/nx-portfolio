import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { RunsPage } from './runs-page';

/**
 * The start form (admin plan 0014, section 3).
 *
 * Two things changed and both are refusals made visible. `REFRESH` cannot be
 * named, because backend plan `0086` deleted the mode: a walk writes its prices
 * now, so nothing was left for a refresh to do. And a Mercadona walk cannot be
 * started without a price scope, because the spawn refuses one, so the field
 * appears exactly where it is required rather than everywhere or nowhere.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';
const NATIONAL = 'scope-national';

/** What the chain picker finds, whatever is typed into it. */
const CHAINS = [
  { id: MERCADONA, title: 'Mercadona' },
  { id: DEZA, title: 'Deza' },
];

/** Long enough for the picker's own 250 ms to settle. */
const SEARCH_SETTLE_MS = 320;

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function spawnRecorder(refusal?: unknown): {
  service: HarvestServiceI;
  spawned: unknown[];
  listed: unknown[];
} {
  const memory = new HarvestMemory();
  const spawned: unknown[] = [];
  const listed: unknown[] = [];

  const service = {
    ...({} as HarvestServiceI),
    listRuns: (query: never) => {
      listed.push(query);
      return memory.listRuns(query);
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

  return { service, spawned, listed };
}

async function render(refusal?: unknown) {
  const { service, spawned, listed } = spawnRecorder(refusal);

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        // The chain's scopes, for the preselection. One national scope, which
        // is what a chain that prices nationwide looks like.
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async () => ({
              items: [{ id: NATIONAL, kind: 'NATIONAL' }],
              nextCursor: null,
            }),
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

  return { fixture: fixture as ComponentFixture<RunsPage>, spawned, listed };
}

/** The form, pointed at one chain and given time to read its source row. */
async function chain(fixture: ComponentFixture<RunsPage>, id: string) {
  fixture.componentInstance.chooseChain(id);
  await drain();
  fixture.detectChanges();
}

/**
 * The chain, chosen the way an operator chooses it: type, wait, click the name.
 *
 * Through the DOM rather than through the component, because the defect this
 * covers was in the binding and not in the method it called.
 */
async function chooseChainByName(
  fixture: ComponentFixture<RunsPage>,
  title: string
) {
  const picker: HTMLElement = fixture.nativeElement.querySelector(
    'lib-reference-picker'
  );
  const input: HTMLInputElement = picker.querySelector('input')!;
  input.value = title;
  input.dispatchEvent(new Event('input'));

  await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLE_MS));
  await drain();
  fixture.detectChanges();

  const option = Array.from(
    picker.querySelectorAll<HTMLButtonElement>('ul button')
  ).find((button) => button.textContent?.trim() === title);
  option!.click();

  await drain();
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<RunsPage>): string =>
  fixture.nativeElement.textContent;

describe('the run form, the modes it offers', () => {
  it('offers three, and cannot name a refresh or a leaflet import', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.modes).toEqual([
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);
    expect(text(fixture)).not.toContain('harvest.mode.REFRESH');
    expect(text(fixture)).not.toContain('harvest.mode.LEAFLET_IMPORT');
  });

  /**
   * An import needs a document, and a document is a file, a preview and a
   * validation failure that names the product it is about. None of that fits
   * three text inputs, so the form offers the way to the screen that does.
   */
  it('sends a file import to the upload screen rather than starting it', async () => {
    const { fixture } = await render();

    fixture.componentInstance.mode.set('FILE_IMPORT');
    fixture.detectChanges();

    expect(fixture.componentInstance.uploading()).toBe(true);
    expect(fixture.componentInstance.uploadLink()).toEqual([
      '/',
      'harvest',
      'imports',
      'upload',
    ]);
  });
});

describe('the run form, the price scope a walk writes to', () => {
  /**
   * The spawn refuses a Mercadona walk without a scope (backend plan 0086,
   * section 9), so the field is on screen and the button is not offered until it
   * is answered.
   */
  it('asks for a scope for a chain fetched through an API that prices', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('mercadona-api');
    expect(page.needsScope()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScope');
  });

  /** Most walks price nationally, so the operator confirms rather than searches. */
  it('preselects the chain national scope', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    expect(fixture.componentInstance.priceScopeId()).toBe(NATIONAL);
    expect(fixture.componentInstance.ready()).toBe(true);
  });

  it('will not start the walk with the scope emptied', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.priceScopeId.set('');
    fixture.detectChanges();

    expect(page.ready()).toBe(false);
    await page.start();
    await drain();

    expect(spawned).toEqual([]);
  });

  it('sends the scope with the walk', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, MERCADONA);

    await fixture.componentInstance.start();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: MERCADONA,
      priceScopeId: NATIONAL,
    });
  });

  /**
   * DEZA's site prints no price, so its walk writes none and the spawn accepts
   * a scope and ignores it. A field that does nothing is a lie in a form.
   */
  it('asks for no scope for a chain whose site prints none', async () => {
    const { fixture, spawned } = await render();
    await chain(fixture, DEZA);
    const page = fixture.componentInstance;

    expect(page.adapterKey()).toBe('deza-web');
    expect(page.needsScope()).toBe(false);
    expect(text(fixture)).not.toContain('harvest.runs.start.priceScope');
    expect(page.ready()).toBe(true);

    await page.start();
    await drain();

    expect(spawned[0]).toEqual({
      mode: 'CATALOG_DISCOVERY',
      supermarketId: DEZA,
    });
  });

  /**
   * A store discovery finds shops and writes no price at all, so the field has
   * nothing to be about whatever the chain's adapter is.
   */
  it('asks for no scope on a store discovery', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);
    const page = fixture.componentInstance;

    page.mode.set('STORE_DISCOVERY');
    fixture.detectChanges();

    expect(page.needsScope()).toBe(false);
  });

  /** A scope of the previous chain is not a scope of this one. */
  it('drops the scope when the chain changes', async () => {
    const { fixture } = await render();
    await chain(fixture, MERCADONA);

    fixture.componentInstance.chooseChain(DEZA);

    expect(fixture.componentInstance.priceScopeId()).toBe('');
  });

  /**
   * The defect this screen was reported with: choosing Mercadona drew no scope
   * field, and choosing a second chain afterwards drew it.
   *
   * The chain was a text input with `[(ngModel)]` and an `(ngModelChange)`
   * beside it. Both listeners answer the same output and they fire in the order
   * the template names them, so the handler read the signal one write behind and
   * asked the source route about the previous chain. Driven through the DOM,
   * because a spec that called the handler itself passed throughout.
   */
  it('asks about the chain just chosen and not the one before it', async () => {
    const { fixture } = await render();

    await chooseChainByName(fixture, 'Mercadona');
    const page = fixture.componentInstance;

    expect(page.supermarketId()).toBe(MERCADONA);
    expect(page.adapterKey()).toBe('mercadona-api');
    expect(page.needsScope()).toBe(true);
    expect(text(fixture)).toContain('harvest.runs.start.priceScope');
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

    await fixture.componentInstance.start();
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

    await fixture.componentInstance.start();
    await drain();
    fixture.detectChanges();

    expect(fixture.componentInstance.blockedDetails()).toEqual([
      'priceScopeId must be a UUID',
    ]);
    expect(text(fixture)).not.toContain('Bad Request');
  });

  /** A failure that really did arrive with nothing in it still says so. */
  it('says the server explained nothing only when it did not', async () => {
    const { fixture } = await render(refusal({ code: '', status: 500 }));
    await chain(fixture, DEZA);

    await fixture.componentInstance.start();
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
