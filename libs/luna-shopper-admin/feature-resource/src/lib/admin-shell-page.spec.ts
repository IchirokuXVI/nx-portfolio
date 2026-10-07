import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, Injectable, signal } from '@angular/core';
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
import {
  provideSections,
  type AdminSection,
  type SectionCounts,
} from './admin-section';
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
  // The app asks which deployment answered before it draws anything, and the
  // frame writes the name it was told.
  await TestBed.inject(DeploymentStore).load();

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

/** The tabs of a page: the screens inside whichever section the URL is in. */
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

  /** The rail is still drawn, so the operator can leave. */
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
 * On a phone the navigation is a bar at the bottom: the first four sections
 * and "More", which opens a sheet with the rest (admin plan 0041, section 2).
 */
describe('AdminShellPage when compact', () => {
  const FIVE: readonly AdminSection[] = [
    ...SECTIONS.slice(0, 3),
    {
      key: 'shoppers',
      label: 'shell.sections.shoppers',
      segment: 'shoppers',
      home: CatalogHome,
    },
    SECTIONS[3],
  ];

  const more = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector(
      'nav.bar [data-menu="more"]'
    ) as HTMLButtonElement;

  it('draws the bar and no rail', async () => {
    const fixture = await render('/catalog', SECTIONS, true);

    expect(fixture.nativeElement.querySelector('nav.rail')).toBeNull();
    expect(fixture.nativeElement.querySelector('nav.bar')).not.toBeNull();
  });

  it('shows the first four sections and keeps the rest behind More', async () => {
    const fixture = await render('/catalog', FIVE, true);
    const hrefs = [...fixture.nativeElement.querySelectorAll('nav.bar a')].map(
      (node) => (node as Element).getAttribute('href')
    );

    expect(hrefs).toEqual(['/', '/catalog', '/harvest', '/shoppers']);
    expect(more(fixture)).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.sheet')).toBeNull();
  });

  it('opens a sheet with the other sections, the language and the way out', async () => {
    const fixture = await render('/catalog', FIVE, true);
    await fixture.whenStable();

    more(fixture).click();
    fixture.detectChanges();

    const sheet = fixture.nativeElement.querySelector('.sheet') as HTMLElement;

    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(
      [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    ).toEqual(['/admins']);
    expect(sheet.textContent).toContain('shell.contentLanguage');
    expect(sheet.textContent).toContain('shell.signOut');
    // The name of the deployment, so that the colour of the bar is never the
    // only sign of which one this is.
    expect(sheet.textContent).toContain('environment.short.development');
  });

  /** Following a section closes the sheet, so it does not cover the page. */
  it('closes on following a section', async () => {
    const fixture = await render('/catalog', FIVE, true);

    more(fixture).click();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.sheet a') as HTMLAnchorElement
    ).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sheet')).toBeNull();
  });

  it('closes on Escape and gives the focus back to More', async () => {
    const fixture = await render('/catalog', FIVE, true);
    document.body.append(fixture.nativeElement);

    more(fixture).click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sheet')).toBeNull();
    expect(document.activeElement).toBe(more(fixture));

    fixture.nativeElement.remove();
  });

  /** "More" is the current entry while the operator is in a section behind it. */
  it('marks More while the current section is one it holds', async () => {
    const inside = await render('/admins', FIVE, true);
    expect(more(inside).classList.contains('current')).toBe(true);

    const outside = await render('/catalog', FIVE, true);
    expect(more(outside).classList.contains('current')).toBe(false);
  });
});

/**
 * The frame on a wide screen: a rail, and nothing above the page (admin plan
 * 0041, section 1).
 */
describe('AdminShellPage on a wide screen', () => {
  it('draws the rail and no bar', async () => {
    const fixture = await render('/catalog');

    expect(fixture.nativeElement.querySelector('nav.rail')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('nav.bar')).toBeNull();
  });

  it('writes the name of the deployment in the rail', async () => {
    const fixture = await render('/catalog');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('nav.rail .deployment').textContent
    ).toContain('environment.short.development');
  });

  it('keeps the way out behind the account button', async () => {
    const fixture = await render('/catalog');
    const account = fixture.nativeElement.querySelector(
      '[data-menu="account"]'
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.querySelector('.menu')).toBeNull();

    account.click();
    fixture.detectChanges();

    expect(account.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.menu').textContent).toContain(
      'shell.signOut'
    );
  });
});

/**
 * The content language control (admin plan 0026, section 7).
 *
 * In the account menu of the rail, because it is a property of who is reading
 * and not of what is on screen. It offers the **content** locales and never
 * `APP_AVAILABLE_LOCALES`, which is the interface's list and is one entry
 * long: conflating the two is exactly what the plan exists to avoid.
 *
 * It had a button of its own beside the account. Admin plan 0049 removed it:
 * the menu says the language, and marks the one in use.
 */
describe('AdminShellPage content language', () => {
  const button = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector(
      '[data-menu="account"]'
    ) as HTMLButtonElement;

  const options = (fixture: { nativeElement: HTMLElement }) =>
    [
      ...fixture.nativeElement.querySelectorAll('.menu button[aria-pressed]'),
    ] as HTMLButtonElement[];

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('offers one option per content locale, in the account menu', async () => {
    const fixture = await render('/');

    button(fixture).click();
    fixture.detectChanges();

    expect(
      options(fixture).map((option) => option.textContent?.trim())
    ).toEqual(CONTENT_LOCALES.map((locale) => `shell.language.${locale}`));
  });

  it('marks the language the operator is reading in', async () => {
    const fixture = await render('/');

    expect(
      fixture.nativeElement.querySelector('[data-menu="language"]')
    ).toBeNull();

    button(fixture).click();
    fixture.detectChanges();

    expect(
      options(fixture).map((option) => option.getAttribute('aria-pressed'))
    ).toEqual(['true', 'false']);
  });

  it('records a choice, so every reader and the next tab pick it up', async () => {
    const fixture = await render('/');

    button(fixture).click();
    fixture.detectChanges();
    options(fixture)[1].click();
    fixture.detectChanges();

    expect(TestBed.inject(ContentLocaleStore).locale()).toBe('es');
    expect(TestBed.inject(ContentLocaleStore).order()).toEqual(['es', 'en']);
    // Choosing closes the menu, and the menu marks the new language when it
    // is opened again.
    expect(options(fixture)).toEqual([]);
    button(fixture).click();
    fixture.detectChanges();
    expect(
      options(fixture).map((option) => option.getAttribute('aria-pressed'))
    ).toEqual(['false', 'true']);
  });

  /**
   * The interface stays English whatever the catalog is read in. The labels
   * around the control are the app's own keys, and the app ships one locale.
   */
  it('leaves the interface locale alone', async () => {
    const fixture = await render('/');

    button(fixture).click();
    fixture.detectChanges();
    options(fixture)[1].click();
    fixture.detectChanges();

    expect(APP_AVAILABLE_LOCALES).toEqual(['en']);
  });
});

/**
 * The count on the rail (admin plan 0044, target 2).
 *
 * The list of sections is a constant written before any injector exists, and
 * a count is read from the gateway. So a section names who counts, the frame
 * resolves it once, and asks it for each link by the link's path.
 */
describe('AdminShellPage counts', () => {
  /** What waits behind the first tab, as a signal a spec can move. */
  const waiting = signal<number | null>(4);
  let asked: string[] = [];

  @Injectable({ providedIn: 'root' })
  class Counter implements SectionCounts {
    countAt(path: string): number | null {
      asked.push(path);
      return path === '/harvest/review' ? waiting() : null;
    }
  }

  const counted: readonly AdminSection[] = [
    { key: 'overview', label: 'shell.sections.overview', home: Overview },
    {
      key: 'harvest',
      label: 'shell.sections.harvest',
      segment: 'harvest',
      landing: 'review',
      screens: [
        { path: 'review', component: NotFoundPage },
        { path: 'runs', component: NotFoundPage },
        { path: 'setup', component: NotFoundPage },
      ],
      links: [
        { path: '/harvest/review', label: 'review' },
        { path: '/harvest/runs', label: 'runs' },
        { path: '/harvest/setup', label: 'setup' },
      ],
      counts: Counter,
    },
    { key: 'admins', label: 'shell.sections.admins', resources: [admins] },
  ];

  const railCount = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement
      .querySelector('nav.rail a[href="/harvest"] .count')
      ?.textContent?.trim() ?? null;

  beforeEach(() => {
    waiting.set(4);
    asked = [];
  });

  it('shows on the section what waits behind its tabs', async () => {
    const fixture = await render('/harvest/review', counted);

    expect(fixture.componentInstance.sections()[1].badge?.()).toBe(4);
    expect(railCount(fixture)).toBe('4');
  });

  /** On every screen of the app, and not only inside the section. */
  it('shows it while another section is open', async () => {
    const fixture = await render('/', counted);

    expect(fixture.componentInstance.screens()).toEqual([]);
    expect(railCount(fixture)).toBe('4');
  });

  it('shows the same count on the tab, and none on the two others', async () => {
    const fixture = await render('/harvest/runs', counted);
    const [review, runs, setup] = fixture.componentInstance.screens();

    expect(review.path).toBe('/harvest/review');
    expect(review.badge?.()).toBe(4);
    expect(runs.badge?.()).toBeNull();
    expect(setup.badge?.()).toBeNull();
  });

  it('asks the counter by the path of each link', async () => {
    const fixture = await render('/harvest/review', counted);
    asked = [];

    fixture.componentInstance.sections()[1].badge?.();

    expect(asked).toEqual([
      '/harvest/review',
      '/harvest/runs',
      '/harvest/setup',
    ]);
  });

  /** A decision takes a row out of a queue, and the rail says so at once. */
  it('follows the count as it changes, on the rail and on the tab', async () => {
    const fixture = await render('/harvest/review', counted);

    waiting.set(3);
    fixture.detectChanges();

    expect(railCount(fixture)).toBe('3');
    expect(fixture.componentInstance.screens()[0].badge?.()).toBe(3);

    waiting.set(148);
    fixture.detectChanges();

    expect(railCount(fixture)).toBe('148');
  });

  /** A drained queue does not need a zero beside its name. */
  it('draws nothing for a count of none', async () => {
    waiting.set(0);
    const fixture = await render('/harvest/review', counted);

    expect(fixture.componentInstance.sections()[1].badge?.()).toBe(0);
    expect(railCount(fixture)).toBeNull();
  });

  /** Not read yet, or the harvester did not answer: nothing is known. */
  it('draws nothing, and answers null, while the count is not known', async () => {
    waiting.set(null);
    const fixture = await render('/harvest/review', counted);

    expect(fixture.componentInstance.sections()[1].badge?.()).toBeNull();
    expect(railCount(fixture)).toBeNull();
  });

  it('keeps the badge a link states for itself', async () => {
    const own: readonly AdminSection[] = [
      counted[0],
      {
        ...counted[1],
        links: [
          { path: '/harvest/review', label: 'review' },
          { path: '/harvest/runs', label: 'runs', badge: () => 9 },
          { path: '/harvest/setup', label: 'setup' },
        ],
      },
    ];
    const fixture = await render('/harvest/review', own);
    asked = [];

    const [review, runs] = fixture.componentInstance.screens();
    expect(review.badge?.()).toBe(4);
    expect(runs.badge?.()).toBe(9);
    // The counter is not asked about a link that answers for itself.
    expect(asked).not.toContain('/harvest/runs');
    // The section sums both.
    expect(fixture.componentInstance.sections()[1].badge?.()).toBe(13);
    expect(railCount(fixture)).toBe('13');
  });

  /** A section that names no counter is as it was: no badge of its own. */
  it('gives no badge to the links of a section with no counter', async () => {
    const plain: readonly AdminSection[] = [
      counted[0],
      { ...counted[1], counts: undefined },
    ];
    const fixture = await render('/harvest/review', plain);

    expect(
      fixture.componentInstance.screens().map((screen) => screen.badge)
    ).toEqual([undefined, undefined, undefined]);
    expect(fixture.componentInstance.sections()[1].badge?.()).toBeNull();
  });

  /** The entry points at the segment, so it stays marked on every tab. */
  it('marks the section on each of its tabs', async () => {
    for (const url of ['/harvest/review', '/harvest/runs', '/harvest/setup']) {
      const fixture = await render(url, counted);
      const marked = [
        ...fixture.nativeElement.querySelectorAll('nav.rail a.current'),
      ].map((node: Element) => node.getAttribute('href'));

      expect(marked).toEqual(['/harvest']);
      expect(fixture.componentInstance.current()).toBe('/harvest');
      expect(
        fixture.componentInstance.screens().map((screen) => screen.label)
      ).toEqual(['review', 'runs', 'setup']);
    }
  });

  it('lands on the tab the section opens on', async () => {
    await render('/harvest', counted);

    expect(TestBed.inject(Router).url).toBe('/harvest/review');
  });
});
