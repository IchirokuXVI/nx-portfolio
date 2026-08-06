import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionHowWeWork } from './section-how-we-work';

describe('SectionHowWeWork', () => {
  let component: SectionHowWeWork;
  let fixture: ComponentFixture<SectionHowWeWork>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionHowWeWork],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionHowWeWork);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
