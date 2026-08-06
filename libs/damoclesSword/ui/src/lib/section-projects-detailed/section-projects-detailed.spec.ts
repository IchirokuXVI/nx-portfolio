import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionProjectsDetailed } from './section-projects-detailed';

describe('SectionProjectsDetailed', () => {
  let component: SectionProjectsDetailed;
  let fixture: ComponentFixture<SectionProjectsDetailed>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionProjectsDetailed],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionProjectsDetailed);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
