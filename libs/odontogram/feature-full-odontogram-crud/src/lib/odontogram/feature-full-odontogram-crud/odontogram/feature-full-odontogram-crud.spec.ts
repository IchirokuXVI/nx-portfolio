import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OdontogramFeatureFullOdontogramCrud } from './feature-full-odontogram-crud';

describe('OdontogramFeatureFullOdontogramCrud', () => {
  let component: OdontogramFeatureFullOdontogramCrud;
  let fixture: ComponentFixture<OdontogramFeatureFullOdontogramCrud>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramFeatureFullOdontogramCrud],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramFeatureFullOdontogramCrud);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
