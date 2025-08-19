import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OdontogramSectorsView } from './odontogram-sectors-view';

describe('OdontogramSectorsView', () => {
  let component: OdontogramSectorsView;
  let fixture: ComponentFixture<OdontogramSectorsView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramSectorsView],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramSectorsView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
