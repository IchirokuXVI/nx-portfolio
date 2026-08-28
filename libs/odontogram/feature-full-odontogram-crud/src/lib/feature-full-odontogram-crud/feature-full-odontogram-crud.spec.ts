import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { ODONTOGRAM_DATA_ACCESS_PROVIDERS } from '@portfolio/odontogram/data-access';
import { OdontogramFeatureFullOdontogramCrud } from './feature-full-odontogram-crud';

describe('OdontogramFeatureFullOdontogramCrud', () => {
  let component: OdontogramFeatureFullOdontogramCrud;
  let fixture: ComponentFixture<OdontogramFeatureFullOdontogramCrud>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramFeatureFullOdontogramCrud],
      // The in-memory services stopped being `providedIn: 'root'` when the app took
      // ownership of its providers, so a spec installs them the same way the app
      // does rather than relying on root scope (plan 0005 D5).
      providers: [
        provideRokuTranslatorTesting(),
        ...ODONTOGRAM_DATA_ACCESS_PROVIDERS,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramFeatureFullOdontogramCrud);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
