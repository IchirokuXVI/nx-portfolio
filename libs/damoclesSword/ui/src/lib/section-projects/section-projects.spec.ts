import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionProjects } from './section-projects';

describe('SectionProjects', () => {
  let component: SectionProjects;
  let fixture: ComponentFixture<SectionProjects>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionProjects],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionProjects);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
