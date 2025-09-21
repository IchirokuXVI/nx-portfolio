import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tooth } from '@portfolio/odontogram/models';
import { SingleToothImage } from './single-tooth-image';

describe('SingleToothImage', () => {
  let component: SingleToothImage;
  let fixture: ComponentFixture<SingleToothImage>;

  const mockTooth: Tooth = {
    number: '11',
    treatments: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SingleToothImage],
    }).compileComponents();

    fixture = TestBed.createComponent(SingleToothImage);
    component = fixture.componentInstance;

    // Set the required tooth input
    fixture.componentRef.setInput('tooth', mockTooth);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
