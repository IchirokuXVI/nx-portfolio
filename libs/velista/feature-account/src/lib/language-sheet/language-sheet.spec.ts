import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { LanguageSheet } from './language-sheet';

interface Options {
  readonly locale?: string;
  readonly basePath?: string;
  /** The data of each route from the root down, or none for a bare spec. */
  readonly routeData?: readonly Record<string, unknown>[];
}

async function render(options: Options = {}): Promise<{
  fixture: ComponentFixture<LanguageSheet>;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  // The sheet sits several routes below the one that names the locales, so the data
  // is spread over `pathFromRoot` the way the real route table spreads it.
  const routeData = options.routeData ?? [
    {},
    { supportedLocales: ['en', 'es'] },
    {},
    {},
  ];

  await TestBed.configureTestingModule({
    imports: [LanguageSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: options.basePath ?? '' }),
      { provide: SheetNavigation, useValue: sheets },
      {
        provide: RokuLocaleStore,
        useValue: { locale: signal(options.locale ?? 'en') },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { pathFromRoot: routeData.map((data) => ({ data })) },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LanguageSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, sheets };
}

function radios(fixture: ComponentFixture<LanguageSheet>): HTMLInputElement[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('input[type="radio"]')
  );
}

function names(fixture: ComponentFixture<LanguageSheet>): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.name')
  ).map((name) => name.textContent?.trim() ?? '');
}

/** A real press on a radio: the click, and the change it fires when it checks one. */
async function press(
  fixture: ComponentFixture<LanguageSheet>,
  index: number
): Promise<void> {
  radios(fixture)[index]?.click();
  await fixture.whenStable();
}

describe('LanguageSheet', () => {
  describe('the choices', () => {
    it('draws one real radio per supported locale, each named in itself', async () => {
      const { fixture } = await render();

      expect(radios(fixture)).toHaveLength(2);
      expect(names(fixture)).toEqual(['English', 'Español']);
      expect(
        fixture.nativeElement.querySelector('[role="radiogroup"]')
      ).not.toBeNull();
    });

    it('checks the language the app is in', async () => {
      const { fixture } = await render({ locale: 'es' });

      expect(radios(fixture).map((radio) => radio.checked)).toEqual([
        false,
        true,
      ]);
    });

    it('offers only the locales the route names', async () => {
      const { fixture } = await render({
        routeData: [{}, { supportedLocales: ['en'] }],
      });

      expect(names(fixture)).toEqual(['English']);
    });

    it('offers every locale the UI ships when no route names any', async () => {
      const { fixture } = await render({ routeData: [{}] });

      expect(names(fixture)).toEqual(['English', 'Español']);
    });
  });

  describe('a press', () => {
    it('switches by leaving for the account page in the new locale', async () => {
      const { fixture, sheets } = await render();

      await press(fixture, 1);

      expect(sheets.leaveTo).toHaveBeenCalledTimes(1);
      expect(sheets.leaveTo).toHaveBeenCalledWith('/es/account');
      expect(sheets.dismiss).not.toHaveBeenCalled();
    });

    it('keeps the mount when there is one', async () => {
      const { fixture, sheets } = await render({ basePath: '/velista' });

      await press(fixture, 1);

      expect(sheets.leaveTo).toHaveBeenCalledWith('/velista/es/account');
    });

    it('on the language already chosen only closes the sheet', async () => {
      const { fixture, sheets } = await render();

      await press(fixture, 0);

      expect(sheets.leaveTo).not.toHaveBeenCalled();
      expect(sheets.dismiss).toHaveBeenCalledWith('/en/account');
    });
  });

  describe('closing', () => {
    it('falls back onto the account page from the shell’s dismiss', async () => {
      const { fixture, sheets } = await render({ basePath: '/velista' });

      fixture.debugElement
        .query(By.directive(SheetShell))
        .triggerEventHandler('dismiss');
      await fixture.whenStable();

      expect(sheets.dismiss).toHaveBeenCalledWith('/velista/en/account');
    });
  });
});
