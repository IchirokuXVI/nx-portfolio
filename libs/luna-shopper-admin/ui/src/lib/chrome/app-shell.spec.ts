import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_FRAME_TABS } from '../page/page-tabs';
import { AppShell, BAR_SECTIONS, type ShellLink } from './app-shell';

/** A page under the frame, which reads the tabs the frame gives it. */
@Component({ selector: 'lib-test-page', template: '' })
class Page {
  readonly tabs = inject(PAGE_FRAME_TABS);
}

const SECTIONS: readonly ShellLink[] = [
  { path: '/', label: 'overview', exact: true },
  { path: '/catalog', label: 'catalog' },
  { path: '/shoppers', label: 'shoppers', badge: () => 0 },
  { path: '/harvest', label: 'harvest', badge: () => 148 },
  { path: '/admins', label: 'admins', badge: () => 3 },
  { path: '/audit', label: 'audit', badge: () => 4 },
];

async function render(
  inputs: Record<string, unknown> = {}
): Promise<ComponentFixture<AppShell>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AppShell, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: Page }]),
      provideLocationMocks(),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppShell);
  fixture.componentRef.setInput('sections', SECTIONS);
  fixture.componentRef.setInput('deployment', 'production');
  fixture.componentRef.setInput('operator', 'Dev Admin');
  fixture.componentRef.setInput('contentLocale', 'en');
  fixture.componentRef.setInput('contentLocales', ['en', 'es']);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return fixture;
}

const all = (fixture: ComponentFixture<AppShell>, selector: string) =>
  [...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];

describe('AppShell, the rail', () => {
  it('has one entry per section and no top bar', async () => {
    const fixture = await render();

    expect(all(fixture, 'nav.rail a.entry')).toHaveLength(SECTIONS.length);
    expect(all(fixture, 'header')).toEqual([]);
  });

  /**
   * A section whose screens carry badges shows their sum, and a count of none
   * draws nothing: a drained queue does not need a zero beside its name.
   */
  it('shows what waits behind a section, and nothing for none', async () => {
    const fixture = await render();
    const counts = all(fixture, 'nav.rail a.entry').map(
      (entry) => entry.querySelector('.count')?.textContent?.trim() ?? null
    );

    expect(counts).toEqual([null, null, null, '148', '3', '4']);
  });

  it('names the deployment in words, so colour is never the only sign', async () => {
    const production = await render();
    expect(all(production, '.deployment')[0].textContent).toContain(
      'environment.short.production'
    );

    const unknown = await render({ deployment: null });
    expect(all(unknown, '.deployment')[0].textContent).toContain(
      'environment.short.unknown'
    );
  });

  /** Still asking is not the same as could not find out, and says nothing yet. */
  it('writes no name while the deployment is still being asked for', async () => {
    const fixture = await render({ deployment: undefined });

    expect(all(fixture, '.deployment')).toEqual([]);
  });

  it('names the account button after the operator and shows two letters', async () => {
    const fixture = await render();
    const [account] = all(fixture, '[data-menu="account"]');

    expect(account.textContent?.trim()).toBe('DA');
    expect(account.getAttribute('aria-label')).toBe('shell.account');
    expect(account.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks to sign out from the account menu', async () => {
    const fixture = await render();
    let left = 0;
    fixture.componentInstance.signOut.subscribe(() => (left += 1));

    all(fixture, '[data-menu="account"]')[0].click();
    fixture.detectChanges();
    all(fixture, '.menu button.danger')[0].click();
    fixture.detectChanges();

    expect(left).toBe(1);
    expect(all(fixture, '.menu')).toEqual([]);
  });

  it('opens one menu at a time', async () => {
    const fixture = await render();

    all(fixture, '[data-menu="language"]')[0].click();
    fixture.detectChanges();
    all(fixture, '[data-menu="account"]')[0].click();
    fixture.detectChanges();

    expect(all(fixture, '.menu')).toHaveLength(1);
    expect(fixture.componentInstance.menu()).toBe('account');
  });

  it('closes a menu on a press outside it', async () => {
    const fixture = await render();
    document.body.append(fixture.nativeElement);

    all(fixture, '[data-menu="account"]')[0].click();
    fixture.detectChanges();
    all(fixture, 'main')[0].click();
    fixture.detectChanges();

    expect(all(fixture, '.menu')).toEqual([]);
    fixture.nativeElement.remove();
  });
});

describe('AppShell, the bar on a phone', () => {
  it('shows at most five entries: four sections and More', async () => {
    const fixture = await render({ compact: true });

    expect(all(fixture, 'nav.bar a.entry')).toHaveLength(BAR_SECTIONS);
    expect(all(fixture, 'nav.bar .entry')).toHaveLength(BAR_SECTIONS + 1);
    expect(all(fixture, 'nav.rail')).toEqual([]);
  });

  /**
   * Work waiting behind an entry the operator cannot see is the one way a bar
   * of five makes this app worse than a list of every section.
   */
  it('sums on More what waits behind the sections it holds', async () => {
    const fixture = await render({ compact: true });
    const [more] = all(fixture, '[data-menu="more"]');

    expect(more.querySelector('.count')?.textContent?.trim()).toBe('7');
  });

  it('marks More while the operator is in a section behind it', async () => {
    const inside = await render({ compact: true, current: '/audit' });
    expect(
      all(inside, '[data-menu="more"]')[0].classList.contains('current')
    ).toBe(true);

    const outside = await render({ compact: true, current: '/catalog' });
    expect(
      all(outside, '[data-menu="more"]')[0].classList.contains('current')
    ).toBe(false);
  });

  it('lists the other sections in the sheet, each with what waits', async () => {
    const fixture = await render({ compact: true });

    all(fixture, '[data-menu="more"]')[0].click();
    fixture.detectChanges();

    expect(
      all(fixture, '.sheet a.item').map((a) => a.getAttribute('href'))
    ).toEqual(['/admins', '/audit']);
    expect(all(fixture, '.sheet .waiting')).toHaveLength(2);
  });

  it('chooses the content language from the sheet', async () => {
    const fixture = await render({ compact: true });
    const chosen: string[] = [];
    fixture.componentInstance.chooseContentLocale.subscribe((locale) =>
      chosen.push(locale)
    );

    all(fixture, '[data-menu="more"]')[0].click();
    fixture.detectChanges();
    all(fixture, '.sheet .language button')[1].click();
    fixture.detectChanges();

    expect(chosen).toEqual(['es']);
  });
});

/**
 * Until each section has a page of its own, its screens are the tabs of every
 * page in it, and the frame is what hands them down (admin plan 0041,
 * section 4).
 */
describe('AppShell, the tabs it gives the page', () => {
  it('provides the screens of the current section to the page it holds', async () => {
    const fixture = await render({
      screens: [
        { path: '/harvest/runs', label: 'runs' },
        { path: '/harvest/places', label: 'places', badge: () => 12 },
      ],
    });

    const tabs = fixture.componentInstance.tabs();

    expect(tabs.map((tab) => [tab.path, tab.label, tab.count?.()])).toEqual([
      ['/harvest/runs', 'runs', null],
      ['/harvest/places', 'places', 12],
    ]);
    // A badge is work that waits, so its count is drawn as waiting.
    expect(tabs.every((tab) => tab.waiting === true)).toBe(true);
  });
});

/**
 * The sizes plan 0041 states as numbers, read out of the source: jsdom lays
 * nothing out, and a spec here loads no component styles.
 */
describe('AppShell, the room it takes', () => {
  const source = readFileSync(join(__dirname, 'app-shell.ts'), 'utf8');
  const tokens = readFileSync(
    join(__dirname, '..', 'styles', '_tokens.scss'),
    'utf8'
  );

  it('is a rail 76 px wide that stays in view beside the page', () => {
    expect(source).toMatch(
      /\n {4}\.rail \{\s*position: sticky;[^}]*inline-size: 4\.75rem;/
    );
  });

  it('is a bar 58 px high, fixed at the bottom, plus the safe area', () => {
    expect(tokens).toContain(
      '--admin-bar: calc(3.625rem + env(safe-area-inset-bottom, 0px));'
    );
    expect(source).toMatch(
      /\n {4}\.bar \{\s*position: fixed;[^}]*block-size: var\(--admin-bar\);/
    );
  });

  /** So that the last row of a long list can be scrolled above the bar. */
  it('reserves the height of the bar under the page', () => {
    expect(source).toMatch(
      /main\.compact \{\s*padding-block-end: calc\(var\(--admin-page-block\) \+ var\(--admin-bar\)\);/
    );
  });

  it('gives the page the whole width: no cap on main', () => {
    expect(source).not.toContain('max-inline-size');
  });
});

/**
 * The "More" sheet is modal: it covers the page behind a scrim, so the focus
 * moves into it and Tab stays in it until it closes.
 */
describe('AppShell, the focus in the More sheet', () => {
  const openSheet = async (fixture: ComponentFixture<AppShell>) => {
    document.body.append(fixture.nativeElement);
    all(fixture, '[data-menu="more"]')[0].click();
    fixture.detectChanges();
    await fixture.whenStable();
    return all(fixture, '.sheet')[0];
  };

  const tab = (target: Element, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  it('says it is modal and takes the focus when it opens', async () => {
    const fixture = await render({ compact: true });
    const sheet = await openSheet(fixture);

    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(sheet);

    fixture.nativeElement.remove();
  });

  it('wraps Tab from its last control to its first, and back', async () => {
    const fixture = await render({ compact: true });
    const sheet = await openSheet(fixture);
    const stops = [...sheet.querySelectorAll<HTMLElement>('a[href], button')];
    const first = stops[0];
    const last = stops[stops.length - 1];

    last.focus();
    expect(tab(last).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    expect(tab(first, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    // In the middle Tab is the browser's own.
    stops[1].focus();
    expect(tab(stops[1]).defaultPrevented).toBe(false);

    fixture.nativeElement.remove();
  });
});

/**
 * A menu closes on a press elsewhere, and the focus stays where that press put
 * it. Only Escape, and a choice made inside the menu, give it back to the
 * button that opened the menu.
 */
describe('AppShell, where the focus goes when a menu closes', () => {
  it('leaves the focus on what was pressed', async () => {
    const fixture = await render();
    const elsewhere = document.createElement('button');
    document.body.append(fixture.nativeElement, elsewhere);

    all(fixture, '[data-menu="account"]')[0].click();
    fixture.detectChanges();
    elsewhere.focus();
    elsewhere.click();
    fixture.detectChanges();

    expect(all(fixture, '.menu')).toEqual([]);
    expect(document.activeElement).toBe(elsewhere);

    fixture.nativeElement.remove();
    elsewhere.remove();
  });

  it('gives the focus back to the button on Escape', async () => {
    const fixture = await render();
    document.body.append(fixture.nativeElement);

    all(fixture, '[data-menu="account"]')[0].click();
    fixture.detectChanges();
    all(fixture, '.menu button')[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(all(fixture, '.menu')).toEqual([]);
    expect(document.activeElement).toBe(
      all(fixture, '[data-menu="account"]')[0]
    );

    fixture.nativeElement.remove();
  });

  it('gives the focus back to the button when a language is chosen', async () => {
    const fixture = await render();
    document.body.append(fixture.nativeElement);

    all(fixture, '[data-menu="language"]')[0].click();
    fixture.detectChanges();
    all(fixture, '.menu button')[1].click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(
      all(fixture, '[data-menu="language"]')[0]
    );

    fixture.nativeElement.remove();
  });
});

/** What plan 0041 says about the look of the two, read out of the source. */
describe('AppShell, the sheet and the menus as the plan draws them', () => {
  const source = readFileSync(join(__dirname, 'app-shell.ts'), 'utf8');

  /** A 120 ms fade on the sheets, and no motion on the menus of the rail. */
  it('fades the sheet and its scrim, and nothing else', () => {
    const animated = [
      ...source.matchAll(/((?:[.\w-]+,\s*)*[.\w-]+) \{\s*animation: ([^;]+);/g),
    ].map((found) => [found[1].replace(/\s+/g, ' '), found[2]]);

    expect(animated).toEqual([['.scrim, .sheet', 'appear 120ms ease-out']]);
  });

  /** Dark text on the near white, in the sheet as in the rail (section 2). */
  it('writes the deployment in the sheet as it does in the rail', () => {
    const base = /\n {4}\.deployment \{([^}]*)\}/.exec(source)?.[1] ?? '';
    const inSheet =
      /\n {4}\.sheet-head \.deployment \{([^}]*)\}/.exec(source)?.[1] ?? '';

    expect(base).toContain('background: var(--admin-count);');
    expect(base).toContain('color: var(--admin-ink);');
    expect(inSheet).not.toMatch(/background|color:/);
  });
});
