import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { activeNavTab, AppNav } from './app-nav';

async function createFixture(
  url: string,
  badge: number | null = null
): Promise<ComponentFixture<AppNav>> {
  await TestBed.configureTestingModule({
    imports: [AppNav, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([]), provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppNav);
  fixture.componentRef.setInput('url', url);
  fixture.componentRef.setInput('badge', badge);
  fixture.detectChanges();
  return fixture;
}

function links(fixture: ComponentFixture<AppNav>): HTMLAnchorElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('a')
  );
}

/** The word under each glyph, in the order the row draws them. */
function words(fixture: ComponentFixture<AppNav>): string[] {
  return links(fixture).map(
    (link) => link.querySelector('.word')?.textContent?.trim() ?? ''
  );
}

/** The index of the tab marked as the page, or -1. */
function activeAt(fixture: ComponentFixture<AppNav>): number {
  return links(fixture).findIndex(
    (link) => link.getAttribute('aria-current') === 'page'
  );
}

describe('AppNav', () => {
  it('draws three tabs, each a word under a glyph', async () => {
    const fixture = await createFixture('/velista/en/home');

    // The testing translator answers with the key, which is what makes the three
    // distinguishable here without asserting English.
    expect(words(fixture)).toEqual(['nav.home', 'nav.catalog', 'nav.basket']);
    expect(links(fixture)).toHaveLength(3);
  });

  it('points each tab at its own screen, under the mount and the locale', async () => {
    const fixture = await createFixture('/velista/en/home');

    expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
      '/en/home',
      '/en/catalog',
      '/en/shopping-lists/current',
    ]);
  });

  /**
   * Section 2. Exactly one tab is lit on the three tab screens and **none** anywhere
   * else: the bar on the account screen is a way out, not a claim about where you are.
   */
  it.each([
    ['home', '/velista/en/home', 0],
    ['the catalog', '/velista/en/catalog', 1],
    ['the basket tab', '/velista/en/shopping-lists/current', 2],
    ['a basket', '/velista/en/shopping-lists/b1', 2],
    ['the history', '/velista/en/shopping-lists', 2],
    ['the account', '/velista/en/account', -1],
    ['a zone list', '/velista/en/zones/z1/lists/l1', -1],
  ])('marks %s', async (_what, url, expected) => {
    const fixture = await createFixture(url);

    expect(activeAt(fixture)).toBe(expected);
    expect(
      links(fixture).filter(
        (link) => link.getAttribute('aria-current') === 'page'
      )
    ).toHaveLength(expected === -1 ? 0 : 1);
  });

  // Colour alone is not a state, so the active tab carries a class the pill is drawn
  // from as well as the attribute a screen reader reads.
  it('draws the active tab twice over', async () => {
    const fixture = await createFixture('/velista/en/home');

    expect(links(fixture)[0]?.classList).toContain('active');
    expect(links(fixture)[1]?.classList).not.toContain('active');
  });

  it('names the row as a landmark', async () => {
    const fixture = await createFixture('/velista/en/home');
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav');

    expect(nav?.getAttribute('aria-label')).toBe('nav.label');
  });

  describe('the badge', () => {
    it('draws nothing for null', async () => {
      const fixture = await createFixture('/velista/en/home', null);

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.badge')
      ).toBeNull();
    });

    // Zero is not a badge: a mark that exists to say something is waiting would be
    // saying the opposite of every other mark in the app.
    it('draws nothing for a basket with nothing left to get', async () => {
      const fixture = await createFixture('/velista/en/home', 0);

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.badge')
      ).toBeNull();
    });

    it('draws the count', async () => {
      const fixture = await createFixture('/velista/en/home', 8);

      expect(
        (fixture.nativeElement as HTMLElement)
          .querySelector('.badge')
          ?.textContent?.trim()
      ).toBe('8');
    });

    it('draws 99+ for anything a person would not read', async () => {
      const fixture = await createFixture('/velista/en/home', 140);

      expect(
        (fixture.nativeElement as HTMLElement)
          .querySelector('.badge')
          ?.textContent?.trim()
      ).toBe('99+');
    });

    // Section 9: the number is in the link's accessible name, never only in a circle.
    it('puts the count in the link, as words', async () => {
      const fixture = await createFixture('/velista/en/home', 8);
      const basket = links(fixture)[2];

      expect(basket?.querySelector('.badge')?.getAttribute('aria-hidden')).toBe(
        'true'
      );
      expect(basket?.textContent).toContain('nav.badge');
    });
  });
});

describe('activeNavTab', () => {
  // The mount is `/velista` under the portfolio and `''` on velista's own origin, so
  // the rule cannot be a segment index.
  it('reads the same tab in both run modes', () => {
    expect(activeNavTab('/velista/en/home')).toBe('home');
    expect(activeNavTab('/en/home')).toBe('home');
  });

  it('lights the basket tab for anything under shopping-lists', () => {
    expect(activeNavTab('/en/shopping-lists')).toBe('basket');
    expect(activeNavTab('/en/shopping-lists/current')).toBe('basket');
    expect(activeNavTab('/en/shopping-lists/b1/sheet/people')).toBe('basket');
  });

  it('lights nothing for a screen that is not one of the three', () => {
    expect(activeNavTab('/en/account')).toBeNull();
    expect(activeNavTab('/en/zones/z1')).toBeNull();
    expect(activeNavTab('/en/assistant')).toBeNull();
  });

  it('ignores the query string and the fragment', () => {
    expect(activeNavTab('/en/shopping-lists?tab=shared')).toBe('basket');
    expect(activeNavTab('/en/account?next=home')).toBeNull();
  });
});
