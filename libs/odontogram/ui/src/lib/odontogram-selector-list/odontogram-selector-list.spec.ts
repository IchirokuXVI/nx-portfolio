import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ToothTreatmentStatus,
  ToothZones,
  TreatmentType,
} from '@portfolio/odontogram/models';
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

    fixture.componentRef.setInput('odontogram', {
      id: 1616,
      name: 'Test Odontogram',
      client: 5,
    });

    fixture.componentRef.setInput('treatments', [
      {
        id: 83116,
        teeth: ['16'],
        type: TreatmentType.STANDARD,
        zones: [ToothZones.TOP],
        status: ToothTreatmentStatus.PENDING,
        groupTeeth: false,
      },
    ]);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
