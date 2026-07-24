import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionOurVision } from './section-our-vision';

describe('SectionOurVision', () => {
  let component: SectionOurVision;
  let fixture: ComponentFixture<SectionOurVision>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionOurVision],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionOurVision);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
