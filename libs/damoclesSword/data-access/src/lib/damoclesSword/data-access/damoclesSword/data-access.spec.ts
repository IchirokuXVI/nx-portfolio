import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordDataAccess } from './data-access';

describe('DamoclesSwordDataAccess', () => {
  let component: DamoclesSwordDataAccess;
  let fixture: ComponentFixture<DamoclesSwordDataAccess>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordDataAccess],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordDataAccess);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
