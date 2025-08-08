import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToothTreatmentModal } from './tooth-treatments-modal';

describe('ToothView', () => {
  let component: ToothTreatmentModal;
  let fixture: ComponentFixture<ToothTreatmentModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToothTreatmentModal],
    }).compileComponents();

    fixture = TestBed.createComponent(ToothTreatmentModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
