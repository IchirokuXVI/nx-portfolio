import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  RouterOutlet,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourceInput,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { provideSections } from './admin-section';
import { ResourceChanges } from './resource-changes';
import { ResourceFormPage } from './resource-form-page';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  RESOURCE_ID_PARAM,
} from './resource-route-data';
import { resourceFormBranch } from './routes';

/**
 * The banner's link (admin plan 0032, section 2.3).
 *
 * A refusal that names a row publishes its id in `details`, and a resource says
 * which codes do that through `ResourceDescriptor.errorLinks`. What is asserted
 * here is the generic half: that the page reads the declaration, resolves the
 * path through the registry rather than out of a segment, and draws nothing at
 * all where any part of that is missing. Which codes a brand declares is
 * `brands.spec.ts`, and nothing in this library knows about brands.
 */

/** What the gateway refuses the submit with, set per test. */
let refusal: GatewayError = new GatewayError({
  code: 'nothing',
  status: 500,
  correlationId: '',
});

const gateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: async (id) => ({ id, label: 'Deborah 48h' }),
  create: () => Promise.reject(refusal),
  update: () => Promise.reject(refusal),
  remove: () => Promise.reject(new Error('not used')),
};

/** The target the link points at. `edit` is what gives it a screen. */
const WIDGETS = defineResource<{ id: string; label: string }>({
  name: 'widgets',
  segment: 'widgets',
  labels: { one: 'widgets.one', many: 'widgets.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'widgets.label' }],
  list: { columns: ['label'], compact: ['label'] },
  actions: { edit: true },
  errorLinks: {
    // One with words of its own, and one without, because the fallback is a
    // branch and a spec that used the same shape twice would not walk it.
    widget_taken: {
      detail: 'widgetId',
      resource: 'widgets',
      label: 'widgets.openHolder',
    },
    widget_too_deep: { detail: 'widgetId', resource: 'widgets' },
  },
  gateway: () => gateway,
});

async function render(): Promise<ComponentFixture<ResourceFormPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceFormPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideRouter([]),
      // The section is what the registry reads, so the link below comes out of
      // where the app mounted this resource and not out of its segment.
      provideSections({
        key: 'stuff',
        label: '',
        segment: 'stuff',
        resources: [WIDGETS],
      }),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: {
              [RESOURCE_DESCRIPTOR]: WIDGETS,
              [RESOURCE_FORM_MODE]: 'edit',
            },
            paramMap: convertToParamMap({ [RESOURCE_ID_PARAM]: 'w1' }),
            queryParamMap: convertToParamMap({}),
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResourceFormPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

/** Lets the read and then the submit settle, then redraws. */
async function settle(fixture: ComponentFixture<ResourceFormPage>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

/** Refuse the next submit this way, and press save. */
async function refuse(
  fixture: ComponentFixture<ResourceFormPage>,
  error: GatewayError
) {
  refusal = error;
  await fixture.componentInstance.submit();
  await settle(fixture);
}

const banner = (fixture: ComponentFixture<ResourceFormPage>) =>
  fixture.nativeElement.querySelector('.banner') as HTMLElement | null;

describe('a refusal that names a row', () => {
  it('draws the sentence and a link the registry built', async () => {
    const fixture = await render();

    await refuse(
      fixture,
      new GatewayError({
        code: 'widget_taken',
        status: 409,
        correlationId: '',
        details: { widgetId: 'w_other' },
      })
    );

    expect(fixture.componentInstance.bannerLink()).toEqual({
      commands: ['/', 'stuff', 'widgets', 'w_other'],
      labelKey: 'widgets.openHolder',
    });

    // Inside the banner, beside the sentence, rather than as a control of its
    // own: it is part of what the refusal said.
    const link = banner(fixture)?.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/stuff/widgets/w_other');
    expect(link.textContent?.trim()).toBe('widgets.openHolder');
    expect(banner(fixture)?.getAttribute('role')).toBe('alert');
  });

  /** A resource that named no words for the link still gets one. */
  it('falls back to the generic words', async () => {
    const fixture = await render();

    await refuse(
      fixture,
      new GatewayError({
        code: 'widget_too_deep',
        status: 409,
        correlationId: '',
        details: { widgetId: 'w_deep' },
      })
    );

    expect(fixture.componentInstance.bannerLink()?.labelKey).toBe(
      'resource.error.openRow'
    );
  });

  it('draws no link for a code the resource did not name', async () => {
    const fixture = await render();

    await refuse(
      fixture,
      new GatewayError({
        code: 'conflict',
        status: 409,
        correlationId: '',
        details: { widgetId: 'w_other' },
      })
    );

    expect(banner(fixture)).not.toBeNull();
    expect(fixture.componentInstance.bannerLink()).toBeNull();
    expect(banner(fixture)?.querySelector('a')).toBeNull();
  });

  /**
   * The details bag is the server's, and a refusal that forgot the id is a
   * sentence with nowhere to go rather than a link to a row called "null".
   */
  it('draws no link when the refusal named no id', async () => {
    const fixture = await render();

    await refuse(
      fixture,
      new GatewayError({ code: 'widget_taken', status: 409, correlationId: '' })
    );

    expect(fixture.componentInstance.bannerLink()).toBeNull();
  });

  /**
   * A refusal explained field by field is drawn under the fields, so there is
   * no banner at all and the link must not outlive it.
   */
  it('draws no link when there is no banner', async () => {
    const fixture = await render();

    await refuse(
      fixture,
      new GatewayError({
        code: 'widget_taken',
        status: 400,
        correlationId: '',
        fieldErrors: { label: ['too long'] },
        details: { widgetId: 'w_other' },
      })
    );

    expect(fixture.componentInstance.bannerKey()).toBeNull();
    expect(fixture.componentInstance.bannerLink()).toBeNull();
  });
});

/**
 * A form under a row of another resource (admin plan 0042).
 *
 * Mounted through the real router, for the reason the list page's spec gives:
 * the id the form needs is a parameter of a route above it, that route has a
 * component, and the router does not hand its parameters down.
 */

interface Line {
  id: string;
  plantId: string;
  name: string;
}

/** What the lines gateway was asked to write, and to read. */
const lineCreates: ResourceInput[] = [];
const lineUpdates: { id: string; input: ResourceInput }[] = [];
const plantReads: string[] = [];

const linesGateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: async (id) => ({ id, plantId: 'p1', name: 'Bottling' }),
  create: async (input) => {
    lineCreates.push(input);
    return { id: 'l_new', ...input };
  },
  update: async (id, input) => {
    lineUpdates.push({ id, input });
    return { id, plantId: 'p1', name: 'Bottling', ...input };
  },
  remove: () => Promise.reject(new Error('not used')),
};

const plantsGateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: async (id) => {
    plantReads.push(id);
    return { id, name: 'Cordoba plant' };
  },
  create: () => Promise.reject(new Error('not used')),
  update: async (id, input) => ({ id, name: 'Cordoba plant', ...input }),
  remove: () => Promise.reject(new Error('not used')),
};

const PLANTS = defineResource<{ id: string; name: string }>({
  name: 'plants',
  segment: 'plants',
  labels: { one: 'plants.one', many: 'plants.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'plants.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => plantsGateway,
});

const LINES = defineResource<Line>({
  name: 'lines',
  segment: 'lines',
  labels: { one: 'lines.one', many: 'lines.many' },
  title: (row) => row.name,
  fields: [
    {
      kind: 'reference',
      name: 'plantId',
      label: 'lines.plant',
      resource: 'plants',
      required: true,
    },
    { kind: 'text', name: 'name', label: 'lines.name', required: true },
  ],
  list: { columns: ['name'], compact: ['name'] },
  parent: { resource: 'plants', param: 'plantId', filter: 'plantId' },
  actions: { create: true, edit: true },
  gateway: () => linesGateway,
});

/** The page the forms are under. It has a component, and that is the point. */
@Component({
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class PlantPage {}

interface Mounted {
  readonly harness: RouterTestingHarness;
  readonly page: ResourceFormPage;
  readonly element: HTMLElement;
}

async function mount(url: string): Promise<Mounted> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideSections({ key: 'plants', label: '', held: [PLANTS, LINES] }),
      provideRouter([
        {
          path: 'plants/:plantId',
          component: PlantPage,
          children: [
            resourceFormBranch(LINES),
            // The parent's own form as a tab of its page: the id is the
            // page's parameter, under the page's name for it.
            {
              path: 'details',
              component: ResourceFormPage,
              data: {
                [RESOURCE_DESCRIPTOR]: PLANTS,
                [RESOURCE_FORM_MODE]: 'edit',
                [RESOURCE_ID_FROM]: 'plantId',
              },
            },
          ],
        },
        // The same form with no parent in the address.
        resourceFormBranch(LINES),
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);

  // The form is the routed component itself where nothing is above it.
  const routed = harness.routeDebugElement;
  return {
    harness,
    page:
      routed?.componentInstance instanceof ResourceFormPage
        ? routed.componentInstance
        : routed?.query(By.directive(ResourceFormPage)).componentInstance,
    element: harness.routeNativeElement as HTMLElement,
  };
}

/** Lets a read or a write settle, then redraws. */
async function drawn(harness: RouterTestingHarness): Promise<void> {
  harness.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.detectChanges();
}

const labels = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('lib-resource-form label')).map((label) =>
    label.textContent?.trim()
  );

describe('a form under a parent row (admin plan 0042)', () => {
  beforeEach(() => {
    lineCreates.length = 0;
    lineUpdates.length = 0;
    plantReads.length = 0;
  });

  /**
   * A picker for the parent would be a second place to answer a question the
   * address answered, and the two could disagree.
   */
  it('draws no control for the parent the address names', async () => {
    const { page, element } = await mount('/plants/p1/lines/new');

    expect(page.fields.map((field) => field.name)).toEqual(['name']);
    expect(labels(element).join(' ')).toContain('lines.name');
    expect(labels(element).join(' ')).not.toContain('lines.plant');
  });

  it('creates the row under that parent', async () => {
    const { page, harness } = await mount('/plants/p1/lines/new');

    expect(page.store.draft()['plantId']).toBe('p1');
    // Filled in by the address and not by the operator, so there is nothing
    // to lose by leaving.
    expect(page.store.dirty()).toBe(false);

    page.change({ name: 'name', value: 'Labelling' });
    await page.submit();
    await drawn(harness);

    expect(lineCreates).toEqual([{ plantId: 'p1', name: 'Labelling' }]);
  });

  /** The address wins over a query string that names another parent. */
  it('does not let a query parameter name a different parent', async () => {
    const { page } = await mount('/plants/p1/lines/new?plantId=p9');

    expect(page.store.draft()['plantId']).toBe('p1');
  });

  /** With no parent in the address, the form asks, as it always did. */
  it('draws the control when the address names no parent', async () => {
    const { page, element } = await mount('/lines/new?plantId=p9');

    expect(page.fields.map((field) => field.name)).toEqual(['plantId', 'name']);
    expect(labels(element).join(' ')).toContain('lines.plant');
    expect(page.store.draft()['plantId']).toBe('p9');
  });

  /**
   * One route up from a form is the address the list is at, and a list that is
   * still drawn has to be told that one of its rows was written.
   */
  it('says what it wrote and goes back one route up after a save', async () => {
    const { page, harness } = await mount('/plants/p1/lines/new');
    const changes = TestBed.inject(ResourceChanges);
    const before = changes.version('lines');

    page.change({ name: 'name', value: 'Labelling' });
    await page.submit();
    await drawn(harness);

    expect(changes.version('lines')).toBe(before + 1);
    expect(changes.version('plants')).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/plants/p1/lines');
  });

  it('says nothing was written when the save was refused', async () => {
    const { page, harness } = await mount('/plants/p1/lines/new');
    const changes = TestBed.inject(ResourceChanges);

    // A required field left empty: the store refuses before the gateway.
    await page.submit();
    await drawn(harness);

    expect(lineCreates).toEqual([]);
    expect(changes.version('lines')).toBe(0);
    expect(TestBed.inject(Router).url).toBe('/plants/p1/lines/new');
  });

  it('edits a row under its parent at the usual parameter', async () => {
    const { page, harness } = await mount('/plants/p1/lines/l1');

    expect(page.fields.map((field) => field.name)).toEqual(['name']);
    page.change({ name: 'name', value: 'Capping' });
    await page.submit();
    await drawn(harness);

    expect(lineUpdates.map((update) => update.id)).toEqual(['l1']);
    expect(lineUpdates[0].input['name']).toBe('Capping');
  });
});

describe('a form that is a tab of the row own page', () => {
  beforeEach(() => {
    plantReads.length = 0;
  });

  it('reads the id from the route above, under the name the route gives', async () => {
    const { page, element } = await mount('/plants/p7/details');

    expect(plantReads).toEqual(['p7']);
    expect(page.mode).toBe('edit');
    expect(page.subtitle()).toBe('Cordoba plant');
    expect(labels(element).join(' ')).toContain('plants.name');
  });

  /**
   * What follows a save is the form's to decide, and a tab overrides it to
   * stay. The override is all a subclass writes: telling the lists is not.
   */
  it('lets a subclass decide what follows a save, and still says what it wrote', async () => {
    const stayed: ResourceRow[] = [];

    @Component({ template: '' })
    class StayingForm extends ResourceFormPage {
      protected override afterSave(row: ResourceRow): void {
        stayed.push(row);
      }
    }

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        provideSections({ key: 'plants', label: '', held: [PLANTS, LINES] }),
        provideRouter([
          {
            path: 'plants/:plantId',
            component: PlantPage,
            children: [
              {
                path: 'details',
                component: StayingForm,
                data: {
                  [RESOURCE_DESCRIPTOR]: PLANTS,
                  [RESOURCE_FORM_MODE]: 'edit',
                  [RESOURCE_ID_FROM]: 'plantId',
                },
              },
            ],
          },
        ]),
      ],
    }).compileComponents();

    const harness = await RouterTestingHarness.create('/plants/p7/details');
    await drawn(harness);
    const page: ResourceFormPage = harness.routeDebugElement?.query(
      By.directive(StayingForm)
    ).componentInstance;

    page.change({ name: 'name', value: 'Sevilla plant' });
    await page.submit();
    await drawn(harness);

    expect(stayed).toEqual([{ id: 'p7', name: 'Sevilla plant' }]);
    expect(TestBed.inject(ResourceChanges).version('plants')).toBe(1);
    expect(TestBed.inject(Router).url).toBe('/plants/p7/details');
  });
});
