import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LANDING_V2_DATA_ACCESS_PROVIDERS } from '@portfolio/landing-v2/data-access';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { LandingV2Wrapper } from './landing-v2-wrapper';

describe('LandingV2Wrapper', () => {
  let component: LandingV2Wrapper;
  let fixture: ComponentFixture<LandingV2Wrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingV2Wrapper],
      providers: [
        provideRouter([]),
        provideRokuTranslatorTesting(),
        ...LANDING_V2_DATA_ACCESS_PROVIDERS,
      ],
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
