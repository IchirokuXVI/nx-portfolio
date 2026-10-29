import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeOperatorSettingsStore,
  MEMORY_OPERATOR_SETTINGS,
  provideFakeOperatorSettingsStore,
} from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { LegalSheet } from './legal-sheet';

/** The form the sheet covers: a page with an outlet for its child. */
@Component({
  selector: 'lib-test-form',
  imports: [RouterOutlet],
  template: '<input id="typed" /><router-outlet />',
})
class TestForm {}

async function render(
  document: 'privacy' | 'terms',
  settings: OperatorSettings = MEMORY_OPERATOR_SETTINGS
) {
  TestBed.resetTestingModule();
  const dismiss = jest.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting(),
      // The shape of the app's table: the covered page is a child of `:locale`, so
      // its own path is the part after the locale.
      provideRouter([
        {
          path: 'en',
          children: [
            {
              path: 'auth/register',
              component: TestForm,
              children: [
                {
                  path: 'sheet/privacy',
                  component: LegalSheet,
                  data: { document: 'privacy' },
                },
                {
                  path: 'sheet/terms',
                  component: LegalSheet,
                  data: { document: 'terms' },
                },
              ],
            },
          ],
        },
      ]),
      provideFakeOperatorSettingsStore(fakeOperatorSettingsStore(settings)),
      { provide: SheetNavigation, useValue: { dismiss } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  });

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/en/auth/register/sheet/${document}`);
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
  }

  return {
    root: harness.fixture.nativeElement as HTMLElement,
    dismiss,
  };
}

describe('LegalSheet (velista 0173, target 6)', () => {
  it('draws the document over the form, which stays underneath', async () => {
    const { root } = await render('terms');

    expect(root.querySelector('#typed')).not.toBeNull();
    expect(root.querySelector('#legal-sheet-title')?.textContent?.trim()).toBe(
      'legal.terms.title'
    );
    // The sections sit one level under the sheet's own h2 title.
    expect(root.querySelectorAll('h3.heading').length).toBeGreaterThan(3);
    expect(root.querySelectorAll('h2.heading')).toHaveLength(0);
  });

  it('opens the other document as a sheet over the same form', async () => {
    const { root } = await render('terms');

    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('lib-legal-sections a')
    )
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/') && href.includes('privacy'));

    expect(links.length).toBeGreaterThan(0);
    expect(
      links.every((href) => href === '/en/auth/register/sheet/privacy')
    ).toBe(true);
  });

  it('links the full page at its foot', async () => {
    const { root } = await render('privacy');

    expect(root.querySelector('.page-link')?.getAttribute('href')).toBe(
      '/en/privacy'
    );
  });

  it('dismisses to the form it covers', async () => {
    const { root, dismiss } = await render('privacy');

    root.querySelector<HTMLButtonElement>('.close')?.click();
    // The shell draws its fall before it asks to leave.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(dismiss).toHaveBeenCalledWith('/en/auth/register');
  });

  it('draws one sentence when the operator published nothing', async () => {
    const { root } = await render('terms', {
      ...MEMORY_OPERATOR_SETTINGS,
      published: false,
    });

    expect(root.querySelector('.unpublished')).not.toBeNull();
    expect(root.querySelector('lib-legal-sections')).toBeNull();
  });
});
