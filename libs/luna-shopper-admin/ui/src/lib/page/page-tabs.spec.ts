import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PageTabs, type PageTab } from './page-tabs';

@Component({ selector: 'lib-test-screen', template: '' })
class Screen {}

const waiting = signal<number | null>(96);

const TABS: readonly PageTab[] = [
  { path: '/chain/shops', label: 'tabs.shops', count: () => 1612 },
  { path: '/chain/sections', label: 'tabs.sections', count: () => 0 },
  {
    path: '/chain/review',
    label: 'tabs.review',
    waiting: true,
    count: () => waiting(),
  },
  { path: '/chain/details', label: 'tabs.details' },
];

async function render(url = '/chain/shops') {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PageTabs, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: Screen }]),
      provideLocationMocks(),
    ],
  }).compileComponents();

  await TestBed.inject(Router).navigateByUrl(url);

  const fixture = TestBed.createComponent(PageTabs);
  fixture.componentRef.setInput('tabs', TABS);
  fixture.componentRef.setInput('label', 'Mercadona');
  fixture.detectChanges();
  // `routerLinkActive` settles in a content hook, one pass after the links.
  fixture.detectChanges();
  return fixture;
}

const links = (fixture: { nativeElement: HTMLElement }) =>
  [...fixture.nativeElement.querySelectorAll('a')] as HTMLAnchorElement[];

describe('PageTabs', () => {
  beforeEach(() => waiting.set(96));

  it('is a navigation of links, named for a screen reader', async () => {
    const fixture = await render();

    expect(
      fixture.nativeElement.querySelector('nav').getAttribute('aria-label')
    ).toBe('Mercadona');
    expect(links(fixture).map((a) => a.getAttribute('href'))).toEqual([
      '/chain/shops',
      '/chain/sections',
      '/chain/review',
      '/chain/details',
    ]);
  });

  it('marks the current tab as the current page', async () => {
    const fixture = await render('/chain/sections');
    const current = links(fixture).filter((a) =>
      a.classList.contains('current')
    );

    expect(current.map((a) => a.getAttribute('href'))).toEqual([
      '/chain/sections',
    ]);
    expect(current[0].getAttribute('aria-current')).toBe('page');
  });

  /** A tab stays marked while the operator is on a screen under it. */
  it('keeps a tab marked on a screen under its path', async () => {
    const fixture = await render('/chain/shops/abc');

    expect(links(fixture)[0].classList.contains('current')).toBe(true);
  });

  /** A tab with nothing behind it does not need a zero beside its name. */
  it('draws a count where there is one and nothing for zero or none', async () => {
    const fixture = await render();
    const counts = links(fixture).map(
      (a) => a.querySelector('.count')?.textContent?.trim() ?? null
    );

    expect(counts).toEqual(['1612', null, '96', null]);
  });

  /**
   * Amber on the page means a person must decide, so a plain count is grey and
   * only work that waits is amber and announced as waiting.
   */
  it('tells work that waits from a plain count', async () => {
    const fixture = await render();
    const [plain, , waits] = links(fixture).map((a) =>
      a.querySelector('.count')
    );

    expect(plain?.classList.contains('waiting')).toBe(false);
    expect(plain?.getAttribute('aria-label')).toBeNull();
    expect(waits?.classList.contains('waiting')).toBe(true);
    expect(waits?.getAttribute('aria-label')).toBe('shell.waiting');
  });

  it('follows a count that changes', async () => {
    const fixture = await render();

    waiting.set(null);
    fixture.detectChanges();

    expect(links(fixture)[2].querySelector('.count')).toBeNull();
  });

  /**
   * A row that does not fit scrolls sideways and never wraps. Read out of the
   * source, because jsdom lays nothing out and a spec here loads no component
   * styles.
   */
  it('scrolls sideways and never wraps', () => {
    const source = readFileSync(join(__dirname, 'page-tabs.ts'), 'utf8');

    expect(source).toMatch(/\n {4}nav \{\s*overflow-x: auto;/);
    expect(source).toMatch(/\n {4}a \{[^}]*white-space: nowrap;/);
    expect(source).not.toContain('flex-wrap');
  });

  it('is 40 px high on a wide screen and 44 px on a phone', () => {
    const source = readFileSync(join(__dirname, 'page-tabs.ts'), 'utf8');

    expect(source).toMatch(/\n {4}a \{[^}]*block-size: 2\.5rem;/);
    expect(source).toMatch(
      /@media \(max-width: 47\.99rem\) \{\s*a \{\s*block-size: 2\.75rem;/
    );
  });
});
