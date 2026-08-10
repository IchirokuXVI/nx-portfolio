import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionWhereWeFit } from './section-where-we-fit';

describe('SectionWhereWeFit', () => {
  let component: SectionWhereWeFit;
  let fixture: ComponentFixture<SectionWhereWeFit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionWhereWeFit],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionWhereWeFit);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
