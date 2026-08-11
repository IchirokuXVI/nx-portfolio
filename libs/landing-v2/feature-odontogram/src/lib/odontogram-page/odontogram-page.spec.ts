import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { OdontogramPage } from './odontogram-page';

jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('es'),
      addNamespace: jest.fn(),
      addTranslations: jest.fn(),
      removeNamespace: jest.fn(),
    },
  };
});

describe('OdontogramPage', () => {
  let fixture: ComponentFixture<OdontogramPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramPage],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramPage);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Odontogram title', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Odontogram'
    );
  });

  it('points the back link at the resolved locale root', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.detail-page__back')?.getAttribute('href')
    ).toBe('/es');
  });

  it('links the live app to /es/odontogram', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.detail-page__link--primary')?.getAttribute('href')
    ).toBe('/es/odontogram');
  });
});
