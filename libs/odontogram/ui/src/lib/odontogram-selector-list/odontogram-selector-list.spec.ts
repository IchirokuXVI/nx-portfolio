import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OdontogramSelectorList } from './odontogram-selector-list';

describe('OdontogramSelectorList', () => {
  let component: OdontogramSelectorList;
  let fixture: ComponentFixture<OdontogramSelectorList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OdontogramSelectorList],
    }).compileComponents();

    fixture = TestBed.createComponent(OdontogramSelectorList);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('odontograms', [
      {
        id: 1616,
        name: 'Test Odontogram',
        client: 5,
      },
    ]);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
