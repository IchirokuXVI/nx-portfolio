import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionWhatWeDo } from './section-what-we-do';

describe('SectionWhatWeDo', () => {
  let component: SectionWhatWeDo;
  let fixture: ComponentFixture<SectionWhatWeDo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionWhatWeDo],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionWhatWeDo);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
