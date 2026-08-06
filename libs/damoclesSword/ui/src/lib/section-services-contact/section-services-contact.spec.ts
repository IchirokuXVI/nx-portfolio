import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionServicesContact } from './section-services-contact';

describe('SectionServicesContact', () => {
  let component: SectionServicesContact;
  let fixture: ComponentFixture<SectionServicesContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionServicesContact],
      providers: [provideRokuTranslatorTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionServicesContact);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
