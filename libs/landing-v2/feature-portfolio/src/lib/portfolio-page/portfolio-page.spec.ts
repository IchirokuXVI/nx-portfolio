import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { PortfolioPage } from './portfolio-page';

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

describe('PortfolioPage', () => {
  let fixture: ComponentFixture<PortfolioPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortfolioPage],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PortfolioPage);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Portfolio title', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-page__title')?.textContent).toBe(
      'Portfolio'
    );
  });

  it('points the back link at the resolved locale root', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.detail-page__back')?.getAttribute('href')
    ).toBe('/en');
  });
});
