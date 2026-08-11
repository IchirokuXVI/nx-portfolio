import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingV2Wrapper } from './landing-v2-wrapper';

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

describe('LandingV2Wrapper', () => {
  let component: LandingV2Wrapper;
  let fixture: ComponentFixture<LandingV2Wrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingV2Wrapper],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingV2Wrapper);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads all 4 projects and every info fact for the resolved locale', () => {
    expect(component.projects).toHaveLength(4);
    expect(component.facts).toHaveLength(4);
  });
});
