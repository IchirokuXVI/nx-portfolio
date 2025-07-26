import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OdontogramUi } from './ui';

describe('OdontogramUi', () => {
  let component: OdontogramUi;
  let fixture: ComponentFixture<OdontogramUi>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramUi],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramUi);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
