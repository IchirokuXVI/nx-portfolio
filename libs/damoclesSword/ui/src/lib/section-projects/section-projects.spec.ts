import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '@portfolio/damoclesSword/data-access';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionProjects } from './section-projects';

describe('SectionProjects', () => {
  let component: SectionProjects;
  let fixture: ComponentFixture<SectionProjects>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionProjects],
      providers: [
        // The data-access services stopped being `providedIn: 'root'` when the
        // app took ownership of its providers (plan 0005 D5).
        ...DAMOCLES_DATA_ACCESS_PROVIDERS,
        provideRokuTranslatorTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionProjects);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
