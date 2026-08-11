import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { DamoclesPage } from './damocles-page';

jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
      addNamespace: jest.fn(),
      addTranslations: jest.fn(),
      removeNamespace: jest.fn(),
    },
  };
});

describe('DamoclesPage', () => {
  let fixture: ComponentFixture<DamoclesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesPage],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesPage);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it("renders the Damocle'Sword title", () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      "Damocle'Sword"
    );
  });

  it('points the back link at the resolved locale root', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.detail-page__back')?.getAttribute('href')
    ).toBe('/en');
  });

  it('links the live app to /en/damoclesSword', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.detail-page__link--primary')?.getAttribute('href')
    ).toBe('/en/damoclesSword');
  });
});
