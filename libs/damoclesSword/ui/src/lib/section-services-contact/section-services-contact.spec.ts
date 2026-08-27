import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '@portfolio/damoclesSword/data-access';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionServicesContact } from './section-services-contact';

describe('SectionServicesContact', () => {
  let component: SectionServicesContact;
  let fixture: ComponentFixture<SectionServicesContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionServicesContact],
      providers: [
        // The data-access services stopped being `providedIn: 'root'` when the
        // app took ownership of its providers (plan 0005 D5).
        ...DAMOCLES_DATA_ACCESS_PROVIDERS,
        provideRokuTranslatorTesting(),
        provideRouter([]),
      ],
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
