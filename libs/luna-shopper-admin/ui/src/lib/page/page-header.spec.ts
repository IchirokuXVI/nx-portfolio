import { Component, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { InfoContent } from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Viewport } from '../viewport';
import { PAGE_HEADING_LEVEL, PageHeader } from './page-header';
import { PAGE_FRAME_TABS, type PageTab } from './page-tabs';

const INFO: InfoContent = {
  title: 'test.info.title',
  points: ['test.info.one'],
};

@Component({
  selector: 'lib-test-page',
  imports: [PageHeader],
  template: `
    <lib-page-header
      (back)="left.set(left() + 1)"
      [backLabel]="backLabel()"
      [backLink]="backLink()"
      [frameTabs]="frameTabs()"
      [heading]="'Mercadona'"
      [info]="info()"
      [subtitle]="subtitle()"
      [tabs]="ownTabs()"
      [tabsLabel]="'Mercadona'"
    >
      @if (chip()) {
        <span class="chip" pageChip>Fetched</span>
      }
      <button pageAction type="button" data-first>Edit chain</button>
      @if (second()) {
        <button (click)="deleted.set(true)" pageMoreAction type="button">
          Delete
        </button>
      }
    </lib-page-header>
  `,
})
class TestPage {
  readonly backLabel = signal<string | null>(null);
  readonly backLink = signal<string | null>(null);
  readonly subtitle = signal<string | null>(null);
  readonly info = signal<InfoContent | null>(null);
  readonly frameTabs = signal(true);
  readonly ownTabs = signal<readonly PageTab[] | null>(null);
  readonly chip = signal(false);
  readonly second = signal(true);
  readonly left = signal(0);
  readonly deleted = signal(false);
}

const TABS: readonly PageTab[] = [
  { path: '/catalog/shops', label: 'shops.many' },
  { path: '/catalog/items', label: 'items.many' },
];

async function render(
  compact = false,
  tabs: readonly PageTab[] | null = null,
  level: Signal<1 | 2> | null = null
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(!compact) },
      },
      ...(tabs === null
        ? []
        : [{ provide: PAGE_FRAME_TABS, useValue: signal(tabs) }]),
      ...(level === null
        ? []
        : [{ provide: PAGE_HEADING_LEVEL, useValue: level }]),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestPage);
  fixture.detectChanges();
  return fixture;
}

const one = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  fixture.nativeElement.querySelector(selector) as HTMLElement | null;

describe('PageHeader', () => {
  it('draws the title as the one heading of the page', async () => {
    const fixture = await render();
    const headings = fixture.nativeElement.querySelectorAll('h1');

    expect(headings).toHaveLength(1);
    expect(headings[0].textContent.trim()).toBe('Mercadona');
  });

  it('draws no way back, no second line and no info button unless asked', async () => {
    const fixture = await render();

    expect(one(fixture, '.page-back')).toBeNull();
    expect(one(fixture, '.page-subtitle')).toBeNull();
    expect(one(fixture, 'lib-info-button')).toBeNull();
  });

  it('draws the second line it is given', async () => {
    const fixture = await render();

    fixture.componentInstance.subtitle.set('Owner marta, 4 members');
    fixture.detectChanges();

    expect(one(fixture, '.page-subtitle')?.textContent).toBe(
      'Owner marta, 4 members'
    );
  });

  /**
   * The way back is a chevron, so its name is what says where it goes.
   */
  it('names the way back and says when it was pressed', async () => {
    const fixture = await render();

    fixture.componentInstance.backLabel.set('Back to chains');
    fixture.detectChanges();

    const back = one(fixture, 'button.page-back');
    expect(back?.getAttribute('aria-label')).toBe('Back to chains');

    back?.click();
    expect(fixture.componentInstance.left()).toBe(1);
  });

  it('makes the way back a link when it is told where it goes', async () => {
    const fixture = await render();

    fixture.componentInstance.backLabel.set('Back to chains');
    fixture.componentInstance.backLink.set('/catalog/supermarkets');
    fixture.detectChanges();

    expect(one(fixture, 'a.page-back')?.getAttribute('href')).toBe(
      '/catalog/supermarkets'
    );
    expect(one(fixture, 'button.page-back')).toBeNull();
  });

  it('draws the info button for the content it is given', async () => {
    const fixture = await render();

    fixture.componentInstance.info.set(INFO);
    fixture.detectChanges();

    expect(one(fixture, 'lib-info-button button')).not.toBeNull();
  });

  it('puts a chip and the actions where the page projected them', async () => {
    const fixture = await render();

    fixture.componentInstance.chip.set(true);
    fixture.detectChanges();

    expect(one(fixture, '.page-chips .chip')?.textContent).toBe('Fetched');
    expect(one(fixture, '.page-actions [data-first]')).not.toBeNull();
    expect(
      one(fixture, '.page-overflow-actions button')?.textContent?.trim()
    ).toBe('Delete');
  });

  /**
   * Two buttons beside a title leave no room for the title on a phone, so the
   * second and later actions go behind one toggle (admin plan 0041, section 3).
   */
  it('keeps the second action in the row on a wide screen', async () => {
    const fixture = await render(false);

    expect(one(fixture, '.page-overflow-toggle')).toBeNull();
    expect(
      one(fixture, '.page-overflow-actions')?.classList.contains('page-menu')
    ).toBe(false);
  });

  it('moves the second action into a More actions menu on a phone', async () => {
    const fixture = await render(true);
    const toggle = one(fixture, '.page-overflow-toggle');
    const menu = one(fixture, '.page-overflow-actions');

    expect(toggle?.getAttribute('aria-label')).toBe('page.moreActions');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.classList.contains('page-menu')).toBe(true);
    expect(menu?.classList.contains('open')).toBe(false);

    toggle?.click();
    fixture.detectChanges();

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(menu?.classList.contains('open')).toBe(true);
    // The first action never moves.
    expect(one(fixture, '.page-actions [data-first]')).not.toBeNull();
  });

  it('runs the action and closes the menu when one is chosen', async () => {
    const fixture = await render(true);

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    one(fixture, '.page-overflow-actions button')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.deleted()).toBe(true);
    expect(
      one(fixture, '.page-overflow-actions')?.classList.contains('open')
    ).toBe(false);
  });

  it('closes the menu on Escape and gives the focus back to the toggle', async () => {
    const fixture = await render(true);
    document.body.append(fixture.nativeElement);

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(
      one(fixture, '.page-overflow-actions')?.classList.contains('open')
    ).toBe(false);
    expect(document.activeElement).toBe(one(fixture, '.page-overflow-toggle'));

    fixture.nativeElement.remove();
  });

  /**
   * The operator pressed something else, and the focus belongs to that. Pulling
   * it back to the toggle would take a field out from under a keyboard.
   */
  it('closes on a press elsewhere and leaves the focus where the press put it', async () => {
    const fixture = await render(true);
    const elsewhere = document.createElement('button');
    document.body.append(fixture.nativeElement, elsewhere);

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    elsewhere.focus();
    elsewhere.click();
    fixture.detectChanges();

    expect(
      one(fixture, '.page-overflow-actions')?.classList.contains('open')
    ).toBe(false);
    expect(document.activeElement).toBe(elsewhere);

    fixture.nativeElement.remove();
    elsewhere.remove();
  });

  /** The chosen action has just left the screen, so the toggle takes the focus. */
  it('gives the focus back to the toggle when an action is chosen', async () => {
    const fixture = await render(true);
    document.body.append(fixture.nativeElement);

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    one(fixture, '.page-overflow-actions button')?.click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(one(fixture, '.page-overflow-toggle'));

    fixture.nativeElement.remove();
  });
});

/**
 * A page has one `h1` (admin plan 0042). A shop open beside its chain's shop
 * list sits under the chain's header, so the pane that holds it says its
 * header is the second level.
 */
describe('PageHeader, under another header', () => {
  it('is the h1 where nothing says it sits under one', async () => {
    const fixture = await render();

    expect(one(fixture, 'h1.page-title')?.textContent?.trim()).toBe(
      'Mercadona'
    );
    expect(one(fixture, 'h2')).toBeNull();
  });

  it('draws its title as an h2 when the pane answers 2', async () => {
    const fixture = await render(false, null, signal<1 | 2>(2));

    expect(one(fixture, 'h2.page-title')?.textContent?.trim()).toBe(
      'Mercadona'
    );
    expect(one(fixture, 'h1')).toBeNull();
  });

  /**
   * The level is a signal because the same shop is the whole page on a phone
   * and a pane on a wide screen, and the window can be resized between them.
   */
  it('follows the level when it changes', async () => {
    const level = signal<1 | 2>(2);
    const fixture = await render(false, null, level);

    level.set(1);
    fixture.detectChanges();

    expect(one(fixture, 'h1.page-title')).not.toBeNull();
    expect(one(fixture, 'h2')).toBeNull();
  });
});

/**
 * A page with tabs of its own hands them to the header, which draws them flush
 * under itself: a sibling row of tabs sits as far below the header as the page
 * spaces its children.
 */
describe('PageHeader, and the tabs of the page', () => {
  const OWN: readonly PageTab[] = [
    { path: '/chain/shops', label: 'tabs.shops', count: () => 1612 },
    { path: '/chain/details', label: 'tabs.details' },
  ];

  const hrefs = (fixture: { nativeElement: HTMLElement }) =>
    [...fixture.nativeElement.querySelectorAll('lib-page-tabs a')].map((a) =>
      a.getAttribute('href')
    );

  it('draws the tabs it is given, inside itself, named for a screen reader', async () => {
    const fixture = await render();

    fixture.componentInstance.ownTabs.set(OWN);
    fixture.detectChanges();

    expect(hrefs(fixture)).toEqual(['/chain/shops', '/chain/details']);
    expect(
      one(fixture, 'lib-page-header > lib-page-tabs nav')?.getAttribute(
        'aria-label'
      )
    ).toBe('Mercadona');
    expect(one(fixture, 'lib-page-tabs .count')?.textContent?.trim()).toBe(
      '1612'
    );
  });

  it('draws them in place of the tabs of the frame', async () => {
    const fixture = await render(false, TABS);

    fixture.componentInstance.ownTabs.set(OWN);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelectorAll('lib-page-tabs')
    ).toHaveLength(1);
    expect(hrefs(fixture)).toEqual(['/chain/shops', '/chain/details']);
  });

  it('draws them with the frame tabs turned off as well', async () => {
    const fixture = await render(false, TABS);

    fixture.componentInstance.frameTabs.set(false);
    fixture.componentInstance.ownTabs.set(OWN);
    fixture.detectChanges();

    expect(hrefs(fixture)).toEqual(['/chain/shops', '/chain/details']);
  });

  it('goes back to the tabs of the frame when it is given none', async () => {
    const fixture = await render(false, TABS);

    expect(hrefs(fixture)).toEqual(['/catalog/shops', '/catalog/items']);
    expect(one(fixture, 'lib-page-tabs nav')?.getAttribute('aria-label')).toBe(
      'shell.screens'
    );
  });
});

/**
 * On a phone the header holds a way back, a chip, the info button, an action
 * and the toggle in one row of 48 px. Read out of the source, because jsdom
 * lays nothing out; the browser walk measures the row itself.
 */
describe('PageHeader, the row on a phone', () => {
  const source = readFileSync(join(__dirname, 'page-header.ts'), 'utf8');

  it('never wraps a chip, and ends it with an ellipsis', () => {
    expect(source).toMatch(
      /:host ::ng-deep \[pageChip\] \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/
    );
  });

  it('lets the chips give way before the title', () => {
    expect(source).toMatch(
      /\.compact \.page-chips \{[^}]*flex: 0 1 auto;[^}]*max-inline-size: 40%;/
    );
    expect(source).toMatch(
      /\.compact \.page-titles \{[^}]*flex: 1 1 0;[^}]*min-inline-size: 5\.5rem;/
    );
    expect(source).not.toContain('flex-wrap');
  });

  /** The plan names a fade for the info panel and the sheets, and for nothing else. */
  it('opens its menu with no motion', () => {
    expect(source).not.toMatch(/animation|transition/);
  });
});

/**
 * Until each section has a page of its own, the screens of the current section
 * are the tabs of every page in it (admin plan 0041, section 4).
 */
describe('PageHeader, and the tabs the frame gives it', () => {
  it('draws no tabs outside the frame', async () => {
    const fixture = await render();

    expect(one(fixture, 'lib-page-tabs')).toBeNull();
  });

  it('draws the tabs of the frame under itself', async () => {
    const fixture = await render(false, TABS);
    const hrefs = [
      ...fixture.nativeElement.querySelectorAll('lib-page-tabs a'),
    ].map((a) => (a as Element).getAttribute('href'));

    expect(hrefs).toEqual(['/catalog/shops', '/catalog/items']);
  });

  it('draws none for a section that has none', async () => {
    const fixture = await render(false, []);

    expect(one(fixture, 'lib-page-tabs')).toBeNull();
  });

  it('leaves them out for a page that draws tabs of its own', async () => {
    const fixture = await render(false, TABS);

    fixture.componentInstance.frameTabs.set(false);
    fixture.detectChanges();

    expect(one(fixture, 'lib-page-tabs')).toBeNull();
  });
});

/**
 * The heights, read out of the source: jsdom lays nothing out and a spec here
 * loads no component styles, and a height is the one thing the plan states as
 * a number.
 */
describe('PageHeader, the size it takes', () => {
  const source = readFileSync(join(__dirname, 'page-header.ts'), 'utf8');

  it('is 52 px on a wide screen and 48 px on a phone', () => {
    expect(source).toMatch(
      /\n {4}\.page-head \{[^}]*min-block-size: 3\.25rem;/
    );
    expect(source).toMatch(
      /\n {4}\.page-head\.compact \{[^}]*min-block-size: 3rem;/
    );
  });

  /** Only the bar at the bottom is fixed on a phone, and nothing on a wide screen. */
  it('does not stick', () => {
    expect(source).not.toMatch(/position:\s*(sticky|fixed)/);
  });
});

/**
 * The More menu (admin plan 0053, section 2.4). `overflow="menu"` puts every
 * later action in it at every width, and the record page is its first user.
 */
@Component({
  selector: 'lib-test-menu-page',
  imports: [PageHeader],
  template: `
    <lib-page-header
      [heading]="'Hacendado'"
      [loading]="loading()"
      [moreLabel]="'More actions for Hacendado'"
      overflow="menu"
    >
      <button pageAction type="button" data-first>Edit</button>
      @for (name of plain(); track name) {
        <button
          (click)="chosen.set(name)"
          [attr.data-plain]="name"
          pageMoreAction
          type="button"
        >
          {{ name }}
        </button>
      }
      @if (destroys()) {
        <button
          (click)="chosen.set('delete')"
          pageMoreDanger
          type="button"
          data-danger
        >
          Delete this brand
        </button>
      }
    </lib-page-header>
  `,
})
class MenuPage {
  readonly plain = signal<readonly string[]>(['Rename', 'Merge']);
  readonly destroys = signal(true);
  readonly loading = signal(false);
  readonly chosen = signal<string | null>(null);
}

async function renderMenu(compact = false) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [MenuPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      {
        provide: Viewport,
        useValue: { compact: signal(compact), split: signal(!compact) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MenuPage);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  return fixture;
}

const press = (element: Element | null, key: string) =>
  element?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('PageHeader, the More menu', () => {
  let fixture: Awaited<ReturnType<typeof renderMenu>>;

  afterEach(() => fixture.nativeElement.remove());

  it('is a menu on a wide screen too, behind a button that says what it opens', async () => {
    fixture = await renderMenu();
    const toggle = one(fixture, '.page-overflow-toggle');
    const menu = one(fixture, '.page-more-items');

    expect(toggle?.getAttribute('aria-haspopup')).toBe('menu');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe(
      'More actions for Hacendado'
    );
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(menu?.classList.contains('open')).toBe(false);
    // "Edit" never moves into the menu.
    expect(one(fixture, '.page-actions [data-first]')).not.toBeNull();
  });

  it('gives each entry the role of a menu item, and starts on the first', async () => {
    fixture = await renderMenu();

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    const items = Array.from(
      fixture.nativeElement.querySelectorAll('.page-more-items button')
    ) as HTMLElement[];
    expect(items.map((item) => item.getAttribute('role'))).toEqual([
      'menuitem',
      'menuitem',
      'menuitem',
    ]);
    expect(one(fixture, '.page-more-items')?.classList.contains('open')).toBe(
      true
    );
    expect(document.activeElement).toBe(items[0]);
  });

  it('puts the actions that destroy last, in a part of their own', async () => {
    fixture = await renderMenu();

    const items = Array.from(
      fixture.nativeElement.querySelectorAll('.page-more-items button')
    ) as HTMLElement[];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Rename',
      'Merge',
      'Delete this brand',
    ]);
    expect(items[2].closest('.page-more-danger')).not.toBeNull();
    expect(items[0].closest('.page-more-danger')).toBeNull();
  });

  /** The line parts the two kinds, so it is drawn only between them. */
  it('draws the line only under an entry, and the part in red', () => {
    const source = readFileSync(join(__dirname, 'page-header.ts'), 'utf8');

    expect(source).toMatch(
      /\.as-menu > \* ~ \.page-more-danger:not\(:empty\) \{[^}]*border-block-start: 1px solid/
    );
    expect(source).toMatch(
      /\.as-menu \.page-more-danger button,[^{]*\{[^}]*color: var\(--admin-danger\)/
    );
  });

  it('moves with the arrows, and wraps at both ends', async () => {
    fixture = await renderMenu();
    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    const items = Array.from(
      fixture.nativeElement.querySelectorAll('.page-more-items button')
    ) as HTMLElement[];

    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    press(document.activeElement, 'ArrowDown');
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(items[2]);
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    fixture = await renderMenu();
    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(one(fixture, '.page-more-items')?.classList.contains('open')).toBe(
      false
    );
    expect(document.activeElement).toBe(one(fixture, '.page-overflow-toggle'));
  });

  it('closes on a press outside', async () => {
    fixture = await renderMenu();
    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    document.body.click();
    fixture.detectChanges();

    expect(one(fixture, '.page-more-items')?.classList.contains('open')).toBe(
      false
    );
  });

  it('runs the entry that was chosen, and closes', async () => {
    fixture = await renderMenu();
    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    one(fixture, '[data-danger]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.chosen()).toBe('delete');
    expect(one(fixture, '.page-more-items')?.classList.contains('open')).toBe(
      false
    );
  });

  /** A menu with no entry is not drawn: the rule counts what the page put in. */
  it('hides the button of a menu that holds nothing', () => {
    const source = readFileSync(join(__dirname, 'page-header.ts'), 'utf8');

    expect(source).toMatch(
      /\.page-overflow:not\(\s*:has\(\s*\.page-more-items > :not\(\.page-more-danger\),\s*\.page-more-danger > \*\s*\)\s*\) \{\s*display: none;/
    );
  });

  it('is a sheet from the bottom on a phone, with rows 48 px high', async () => {
    fixture = await renderMenu(true);

    expect(one(fixture, 'lib-popover-sheet')).toBeNull();

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    const sheet = one(fixture, 'lib-popover-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.querySelector('.panel')?.classList.contains('sheet')).toBe(
      true
    );
    expect(sheet?.querySelector('h2')?.textContent?.trim()).toBe(
      'More actions for Hacendado'
    );
    const list = sheet?.querySelector('.page-more-items');
    expect(list?.getAttribute('role')).toBe('menu');
    expect(
      Array.from(list?.querySelectorAll('button') ?? []).map((item) =>
        item.getAttribute('role')
      )
    ).toEqual(['menuitem', 'menuitem', 'menuitem']);

    const source = readFileSync(join(__dirname, 'page-header.ts'), 'utf8');
    expect(source).toMatch(
      /\.as-menu\.as-sheet button,[^{]*\{[^}]*min-block-size: 3rem;/
    );
  });

  it('closes the sheet when an entry is chosen, and when it asks to close', async () => {
    fixture = await renderMenu(true);
    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();

    one(fixture, '[data-plain="Rename"]')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.chosen()).toBe('Rename');
    expect(one(fixture, 'lib-popover-sheet')).toBeNull();

    one(fixture, '.page-overflow-toggle')?.click();
    fixture.detectChanges();
    (one(fixture, 'lib-popover-sheet .close') as HTMLElement).click();
    fixture.detectChanges();
    expect(one(fixture, 'lib-popover-sheet')).toBeNull();
    expect(document.activeElement).toBe(one(fixture, '.page-overflow-toggle'));
  });
});

describe('PageHeader, a title that is on its way', () => {
  it('keeps the words in the heading, and marks it as a bar', async () => {
    const fixture = await renderMenu();
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    // The words stay for a screen reader. The rule takes their ink away.
    expect(one(fixture, 'h1')?.textContent).toBe('Hacendado');
    expect(one(fixture, '.page-titles')?.classList.contains('pending')).toBe(
      true
    );

    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();
    expect(one(fixture, '.page-titles')?.classList.contains('pending')).toBe(
      false
    );
    fixture.nativeElement.remove();
  });
});
