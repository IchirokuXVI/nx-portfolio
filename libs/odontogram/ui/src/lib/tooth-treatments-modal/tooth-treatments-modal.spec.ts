import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { Tooth } from '@portfolio/odontogram/models';
import { ToothTreatmentsModal } from './tooth-treatments-modal';

describe('ToothView', () => {
  let component: ToothTreatmentsModal;
  let fixture: ComponentFixture<ToothTreatmentsModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToothTreatmentsModal, RokuTranslatorTestingModule.forTesting()],
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
