import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionWhoWeAre } from './section-who-we-are';

describe('SectionWhoWeAre', () => {
  let component: SectionWhoWeAre;
  let fixture: ComponentFixture<SectionWhoWeAre>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionWhoWeAre],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionWhoWeAre);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
