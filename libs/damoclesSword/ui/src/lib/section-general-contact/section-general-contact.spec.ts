import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionGeneralContact } from './section-general-contact';

describe('SectionGeneralContact', () => {
  let component: SectionGeneralContact;
  let fixture: ComponentFixture<SectionGeneralContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionGeneralContact],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionGeneralContact);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
