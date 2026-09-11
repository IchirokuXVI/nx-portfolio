import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  RESOURCE_GATEWAYS,
  ServerReachability,
  SessionStorage,
  SessionStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  defineResource,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  APP_AVAILABLE_LOCALES,
  NotFoundPage,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { provideSections, type AdminSection } from './admin-section';
import { AdminShellPage } from './admin-shell-page';
import { adminRoutes } from './routes';

interface Shop extends ResourceRow {
  id: string;
  name: string;
}

function resource(name: string): ReturnType<typeof defineResource<Shop>> {
  return defineResource<Shop>({
    name,
    segment: name,
    labels: { one: `${name}.one`, many: `${name}.many` },
    title: (row) => row.name,
    fields: [{ kind: 'text', name: 'name', label: 'name' }],
    list: { columns: ['name'], compact: ['name'] },
    // The in-memory gateway, because a tab this spec follows lands on the real
    // list page and that page builds one on construction.
    gateway: () =>
      inject(RESOURCE_GATEWAYS).for<Shop>({
        path: `/v1/admin/${name}`,
        seed: [{ id: `${name}-1`, name }],
      }),
  });
}

const shops = resource('shops');
const items = resource('items');
const admins = resource('admins');

/**
 * Two homes with nothing in them.
 *
 * Real components rather than plain classes, because the shell holds the outlet
 * and the outlet activates whatever the URL resolved to.
 */
@Component({ selector: 'lib-test-overview', template: '' })
class Overview {}

@Component({ selector: 'lib-test-home', template: '' })
class CatalogHome {}

/** The five section shape of admin plan 0022, in miniature. */
const SECTIONS: readonly AdminSection[] = [
  { key: 'overview', label: 'shell.sections.overview', home: Overview },
  {
    key: 'catalog',
    label: 'shell.sections.catalog',
    segment: 'catalog',
    home: CatalogHome,
    resources: [shops, items],
  },
  {
    key: 'harvest',
    label: 'shell.sections.harvest',
    segment: 'harvest',
    home: CatalogHome,
    screens: [{ path: 'runs', component: NotFoundPage }],
    links: [{ path: '/harvest/runs', label: 'harvest.nav.runs' }],
  },
  { key: 'admins', label: 'shell.sections.admins', resources: [admins] },
];

async function render(
  url: string,
  sections: readonly AdminSection[] = SECTIONS,
  compact = false
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AdminShellPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      // The chrome's own children, not the branch that draws the chrome: this
      // spec creates the shell itself, so handing the router the outer route
      // would activate a second shell inside the first.
      provideRouter(adminRoutes(sections)[0].children ?? []),
      provideLocationMocks(),
      provideSections(...sections),
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
      // jsdom reports every media query as unmatched, so the narrow layout is
      // reachable only by standing in for the service that reads one.
      { provide: Viewport, useValue: { compact: signal(compact) } },
    ],
  }).compileComponents();

  await TestBed.inject(Router).navigateByUrl(url);

  const fixture = TestBed.createComponent(AdminShellPage);
  fixture.detectChanges();
  return fixture;
}

/** The first row: one tab per section, pointing at its home. */
describe('AdminShellPage sections', () => {
  it('is one entry per section, in the order the app named them', async () => {
    const fixture = await render('/');

    expect(
      fixture.componentInstance.sections().map((link) => link.label)
    ).toEqual([
      'shell.sections.overview',
      'shell.sections.catalog',
      'shell.sections.harvest',
      'shell.sections.admins',
    ]);
  });

  /**
   * A section link goes to its home, and a section with one screen and no home
   * goes straight at that screen. `/admins/admins` would be a click and a
   * segment nobody asked for.
   */
  it('points a section with one screen straight at it', async () => {
    const fixture = await render('/');
    const paths = fixture.componentInstance.sections().map((l) => l.path);

    expect(paths).toEqual(['/', '/catalog', '/harvest', '/admins']);
  });

  /**
   * A link to `/` with prefix matching is the current page on every screen in
   * the app, since every URL starts with a slash. Only the overview needs the
   * exception, so only the overview gets it, and `/admins` keeps matching a row
   * inside it.
   */
  it('matches the overview exactly and every other section by prefix', async () => {
    const fixture = await render('/');

    expect(
      fixture.componentInstance.sections().map((link) => link.exact === true)
    ).toEqual([true, false, false, false]);
  });
});

/** The second row: the screens inside whichever section the URL is in. */
describe('AdminShellPage screens', () => {
  it('is the current section resources, by their descriptor labels', async () => {
    const fixture = await render('/catalog');

    expect(fixture.componentInstance.screens()).toEqual([
      { path: '/catalog/shops', label: 'shops.many' },
      { path: '/catalog/items', label: 'items.many' },
    ]);
  });

  /**
   * The longest matching link, not the first. `/harvest` and `/harvest/runs`
   * are both prefixes of a run's URL and only one of them is a section.
   */
  it('stays on the section while the operator is deep inside it', async () => {
    const fixture = await render('/catalog/items/abc');

    expect(
      fixture.componentInstance.screens().map((link) => link.path)
    ).toEqual(['/catalog/shops', '/catalog/items']);
  });

  it('draws a hand written screen before the section resources', async () => {
    const fixture = await render('/harvest/runs');

    expect(
      fixture.componentInstance.screens().map((link) => link.label)
    ).toEqual(['harvest.nav.runs']);
  });

  /** The overview has nothing below it: its section is its home and no more. */
  it('is empty for a section with only its own home', async () => {
    const fixture = await render('/');

    expect(fixture.componentInstance.screens()).toEqual([]);
  });

  /**
   * The admins section, whose tab points straight at its one screen. A second
   * row repeating the word above it says nothing an operator did not just read.
   */
  it('is empty for a section whose tab already is its only screen', async () => {
    const fixture = await render('/admins');

    expect(fixture.componentInstance.screens()).toEqual([]);
  });

  /**
   * A URL matching no screen is the not found page. The operator is somewhere
   * the app does not know about, and guessing a section for them is worse than
   * admitting it.
   */
  it('marks no section for a URL that matches nothing', async () => {
    const fixture = await render('/nowhere');
    const marked = [...fixture.nativeElement.querySelectorAll('nav a.current')];

    expect(marked).toEqual([]);
    expect(fixture.componentInstance.screens()).toEqual([]);
  });

  /** Both rows are still drawn, so the operator can leave. */
  it('still draws the sections for a URL that matches nothing', async () => {
    const fixture = await render('/nowhere');
    const hrefs = [...fixture.nativeElement.querySelectorAll('nav a')].map(
      (node: Element) => node.getAttribute('href')
    );

    expect(hrefs).toEqual(['/', '/catalog', '/harvest', '/admins']);
  });
});

/**
 * Work waiting behind a link an operator can no longer see is the one way two
 * rows make this app worse than one. The sum is the answer to it.
 */
describe('AdminShellPage badges', () => {
  const withBadges: readonly AdminSection[] = [
    { key: 'overview', label: 'shell.sections.overview', home: Overview },
    {
      key: 'harvest',
      label: 'shell.sections.harvest',
      segment: 'harvest',
      home: CatalogHome,
      screens: [{ path: 'runs', component: NotFoundPage }],
      links: [
        { path: '/harvest/runs', label: 'a', badge: () => 2 },
        { path: '/harvest/places', label: 'b', badge: () => 3 },
        { path: '/harvest/shops', label: 'c' },
      ],
    },
  ];

  it('sums its screens', async () => {
    const fixture = await render('/', withBadges);
    const harvest = fixture.componentInstance.sections()[1];

    expect(harvest.badge?.()).toBe(5);
  });

  /**
   * `null` is not zero, even though both draw nothing. A queue that has not been
   * read has no count at all; one that was read and found empty has a count of
   * none (admin plan 0010, section 4).
   */
  it('is null only when every screen it holds answers null', async () => {
    const silent: readonly AdminSection[] = [
      {
        key: 'harvest',
        label: 'shell.sections.harvest',
        segment: 'harvest',
        home: CatalogHome,
        links: [{ path: '/harvest/runs', label: 'a' }],
      },
    ];
    const fixture = await render('/harvest', silent);

    expect(fixture.componentInstance.sections()[0].badge?.()).toBeNull();
  });

  it('keeps a zero that a screen actually answered', async () => {
    const drained: readonly AdminSection[] = [
      {
        key: 'harvest',
        label: 'shell.sections.harvest',
        segment: 'harvest',
        home: CatalogHome,
        links: [{ path: '/harvest/runs', label: 'a', badge: () => 0 }],
      },
    ];
    const fixture = await render('/harvest', drained);

    expect(fixture.componentInstance.sections()[0].badge?.()).toBe(0);
  });
});

/**
 * On a phone the menu is the sections, with the current one's screens indented
 * under it. A menu that opens twenty three links has not solved anything.
 */
describe('AdminShellPage when compact', () => {
  it('expands the current section and no other', async () => {
    const fixture = await render('/catalog', SECTIONS, true);
    const toggle = fixture.nativeElement.querySelector(
      'button.toggle'
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    // `routerLinkActive` settles in a content hook, which runs after the
    // bindings of the pass that created it, so the indented list appears on the
    // next one.
    fixture.detectChanges();

    const inside = [
      ...fixture.nativeElement.querySelectorAll('ul.inside'),
    ] as HTMLElement[];

    expect(inside).toHaveLength(1);
    expect(
      [...inside[0].querySelectorAll('a')].map((a) => a.getAttribute('href'))
    ).toEqual(['/catalog/shops', '/catalog/items']);
  });

  /** Following either level closes the menu, so it does not cover the page. */
  it('closes on following a screen', async () => {
    const fixture = await render('/catalog', SECTIONS, true);
    const toggle = fixture.nativeElement.querySelector(
      'button.toggle'
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      'ul.inside a'
    ) as HTMLAnchorElement;
    link.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#shell-nav')).toBeNull();
  });

  /** There is no second row on a phone: the screens live inside the menu. */
  it('draws no second row of its own', async () => {
    const fixture = await render('/catalog', SECTIONS, true);

    expect(fixture.nativeElement.querySelector('.second')).toBeNull();
  });
});

/**
 * The content language control (admin plan 0026, section 7).
 *
 * In the header beside the operator's name, because it is a property of who is
 * reading and not of what is on screen. It offers the **content** locales and
 * never `APP_AVAILABLE_LOCALES`, which is the interface's list and is one entry
 * long: conflating the two is exactly what the plan exists to avoid.
 */
describe('AdminShellPage content language', () => {
  const control = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector(
      '.identity select'
    ) as HTMLSelectElement | null;

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('offers one option per content locale, beside the operator', async () => {
    const fixture = await render('/');
    const select = control(fixture);

    expect(select).not.toBeNull();
    expect(
      [...(select?.options ?? [])].map((option) => option.value)
    ).toEqual([...CONTENT_LOCALES]);
  });

  it('shows the language the operator is reading in', async () => {
    const fixture = await render('/');

    expect(control(fixture)?.value).toBe(CONTENT_LOCALES[0]);
  });

  it('records a choice, so every reader and the next tab pick it up', async () => {
    const fixture = await render('/');
    const select = control(fixture);

    if (select === null) {
      throw new Error('there is no content language control');
    }
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(TestBed.inject(ContentLocaleStore).locale()).toBe('es');
    expect(TestBed.inject(ContentLocaleStore).order()).toEqual(['es', 'en']);
  });

  /**
   * The interface stays English whatever the catalog is read in. The labels
   * around the control are the app's own keys, and the app ships one locale.
   */
  it('leaves the interface locale alone', async () => {
    const fixture = await render('/');
    const select = control(fixture);

    select?.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(APP_AVAILABLE_LOCALES).toEqual(['en']);
  });
});
