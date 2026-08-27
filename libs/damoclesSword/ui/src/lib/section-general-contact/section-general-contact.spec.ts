import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '@portfolio/damoclesSword/data-access';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { SectionGeneralContact } from './section-general-contact';

describe('SectionGeneralContact', () => {
  let component: SectionGeneralContact;
  let fixture: ComponentFixture<SectionGeneralContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionGeneralContact],
      providers: [
        // The data-access services stopped being `providedIn: 'root'` when the
        // app took ownership of its providers (plan 0005 D5).
        ...DAMOCLES_DATA_ACCESS_PROVIDERS,
        provideRokuTranslatorTesting(),
        provideRouter([]),
      ],
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
