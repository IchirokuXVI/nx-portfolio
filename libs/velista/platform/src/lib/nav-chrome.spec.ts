import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { NAV_CHROME, NavChrome, NO_NAV_CHROME } from './nav-chrome';

/** A page to activate, since a route with no component activates nothing. */
@Component({ selector: 'lib-test-page', template: '' })
class TestPage {}

/** The four screens of section 4, plus the pages the bar is drawn on. */
const routes: Routes = [
  { path: '', component: TestPage, data: { [NAV_CHROME]: NO_NAV_CHROME } },
  {
    path: 'auth/login',
    component: TestPage,
    data: { [NAV_CHROME]: NO_NAV_CHROME },
  },
  {
    path: 'join/:code',
    component: TestPage,
    data: { [NAV_CHROME]: NO_NAV_CHROME },
  },
  {
    path: 's/:secret',
    component: TestPage,
    data: { [NAV_CHROME]: NO_NAV_CHROME },
  },
  {
    path: 'home',
    component: TestPage,
    children: [{ path: 'sheet/get', component: TestPage, data: {} }],
  },
  { path: 'account', component: TestPage },
  { path: 'zones/:zoneId/lists/:listId', component: TestPage },
];

async function goTo(url: string): Promise<NavChrome> {
  const chrome = TestBed.inject(NavChrome);
  await TestBed.inject(Router).navigateByUrl(url);
  return chrome;
}

describe('NavChrome', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  /**
   * Section 3, and the reason the default is false: a bar drawn for somebody with no
   * account offers two tabs that answer with a sign in screen.
   */
  it('draws nothing until the session says the tabs can be used', async () => {
    const chrome = await goTo('/home');

    expect(chrome.visible()).toBe(false);

    chrome.setUsable(true);

    expect(chrome.visible()).toBe(true);
  });

  it('draws the bar on a page that says nothing about it', async () => {
    const chrome = await goTo('/account');
    chrome.setUsable(true);

    expect(chrome.visible()).toBe(true);

    await TestBed.inject(Router).navigateByUrl('/zones/z1/lists/l1');

    expect(chrome.visible()).toBe(true);
  });

  // Section 4. Each of the four is one task with one way out, and two of the three
  // tabs need an account.
  it.each([
    ['the front door', '/'],
    ['a credential screen', '/auth/login'],
    ['an invitation', '/join/ABC123'],
    ["a guest's way in", '/s/secret-token'],
  ])('draws nothing on %s', async (_what, url) => {
    const chrome = await goTo(url);
    chrome.setUsable(true);

    expect(chrome.visible()).toBe(false);
  });

  /**
   * Section 5. A sheet keeps the screen's bottom edge and its scrim covers everything,
   * so the bar is absent rather than behind it.
   */
  it('draws nothing under an open sheet', async () => {
    const chrome = await goTo('/home');
    chrome.setUsable(true);
    expect(chrome.visible()).toBe(true);

    await TestBed.inject(Router).navigateByUrl('/home/sheet/get');

    expect(chrome.visible()).toBe(false);
  });

  /**
   * The room stays while the sheet is up, and only the bar goes. Giving the room back
   * too would reflow the page under the sheet by the height of the bar on the way in
   * and back again on the way out, under a scrim, for nothing.
   */
  it('keeps the room it reserves while a sheet covers the bar', async () => {
    const chrome = await goTo('/home/sheet/get');
    chrome.setUsable(true);

    expect(chrome.visible()).toBe(false);
    expect(chrome.reserved()).toBe(true);
  });

  it('reserves nothing on a screen the bar is not drawn on at all', async () => {
    const chrome = await goTo('/auth/login');
    chrome.setUsable(true);

    expect(chrome.reserved()).toBe(false);
  });

  it('draws the bar again when the sheet is dismissed', async () => {
    const chrome = await goTo('/home/sheet/get');
    chrome.setUsable(true);
    expect(chrome.visible()).toBe(false);

    await TestBed.inject(Router).navigateByUrl('/home');

    expect(chrome.visible()).toBe(true);
  });

  // The URL test cuts the query off first, so a parameter holding the word cannot
  // close the bar on a page that has no sheet over it.
  it('reads the path and not the query string', async () => {
    const chrome = await goTo('/account?from=sheet');
    chrome.setUsable(true);

    expect(chrome.visible()).toBe(true);
  });

  it('reports where the app is, for the tab that lights up', async () => {
    const chrome = await goTo('/zones/z1/lists/l1');

    expect(chrome.url()).toBe('/zones/z1/lists/l1');
  });
});
