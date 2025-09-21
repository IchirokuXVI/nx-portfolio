import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToothTreatmentsModal } from './tooth-treatments-modal';

describe('ToothView', () => {
  let component: ToothTreatmentsModal;
  let fixture: ComponentFixture<ToothTreatmentsModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToothTreatmentsModal],
    }).compileComponents();

    fixture = TestBed.createComponent(ToothTreatmentsModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
