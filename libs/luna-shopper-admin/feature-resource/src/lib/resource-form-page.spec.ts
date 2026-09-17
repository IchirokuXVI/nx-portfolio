import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { provideSections } from './admin-section';
import { ResourceFormPage } from './resource-form-page';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_PARAM,
} from './resource-route-data';

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
