import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { AdminShellPage } from './admin-shell-page';
import { provideResources } from './resource-registry';
import { provideShellLinks } from './shell-links';

interface Shop extends ResourceRow {
  id: string;
  name: string;
}

const shops = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'shops.name' }],
  list: { columns: ['name'], compact: ['name'] },
  gateway: () => {
    throw new Error('not used');
  },
});

async function render(extra: Parameters<typeof provideShellLinks>) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AdminShellPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      provideResources(shops),
      provideShellLinks(...extra),
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
      SessionStorage,
      SessionStore,
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AdminShellPage);
  fixture.detectChanges();
  return fixture;
}

/**
 * The navigation is every resource, then every screen that is not one.
 *
 * Resources come from the registry, which is what stops a resource being
 * reachable without a link. A hand written screen has no descriptor to be read
 * from, so this token is where it says it exists.
 */
describe('AdminShellPage navigation', () => {
  it('is the resources alone when nothing else is named', async () => {
    const fixture = await render([]);

    expect(fixture.componentInstance.links()).toEqual([
      { path: '/shops', label: 'shops.many' },
    ]);
  });

  it('adds the named screens after the resources', async () => {
    const fixture = await render([
      { path: '/harvest/runs', label: 'harvest.nav.runs' },
    ]);

    expect(fixture.componentInstance.links()).toEqual([
      { path: '/shops', label: 'shops.many' },
      { path: '/harvest/runs', label: 'harvest.nav.runs' },
    ]);
  });

  it('draws a link for every one of them', async () => {
    const fixture = await render([
      { path: '/harvest/runs', label: 'harvest.nav.runs' },
      { path: '/harvest/sources', label: 'harvest.nav.sources' },
    ]);

    const hrefs = [...fixture.nativeElement.querySelectorAll('nav a')].map(
      (node: Element) => node.getAttribute('href')
    );

    expect(hrefs).toEqual(['/shops', '/harvest/runs', '/harvest/sources']);
  });
});
