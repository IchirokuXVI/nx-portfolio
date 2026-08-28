import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ODONTOGRAM_DATA_ACCESS_PROVIDERS } from '@portfolio/odontogram/data-access';
import { Tooth } from '@portfolio/odontogram/models';
import { ToothTreatmentsModal } from './tooth-treatments-modal';

describe('ToothView', () => {
  let component: ToothTreatmentsModal;
  let fixture: ComponentFixture<ToothTreatmentsModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToothTreatmentsModal, RokuTranslatorTestingModule.forTesting()],
      providers: [...ODONTOGRAM_DATA_ACCESS_PROVIDERS],
    }).compileComponents();

    fixture = TestBed.createComponent(ToothTreatmentsModal);

    fixture.componentRef.setInput('tooth', {
      number: '11',
    } as Tooth);

    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
