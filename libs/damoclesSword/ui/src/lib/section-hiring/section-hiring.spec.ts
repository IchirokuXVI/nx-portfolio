import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionHiring } from './section-hiring';

describe('SectionHiring', () => {
  let component: SectionHiring;
  let fixture: ComponentFixture<SectionHiring>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionHiring],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionHiring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
