import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionOurValues } from './section-our-values';

describe('SectionOurValues', () => {
  let component: SectionOurValues;
  let fixture: ComponentFixture<SectionOurValues>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionOurValues],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionOurValues);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose the four studio values', () => {
    expect(component.values).toHaveLength(4);
  });
});
