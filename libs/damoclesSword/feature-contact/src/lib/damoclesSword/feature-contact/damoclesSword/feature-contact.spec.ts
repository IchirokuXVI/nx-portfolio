import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordFeatureContact } from './feature-contact';

describe('DamoclesSwordFeatureContact', () => {
  let component: DamoclesSwordFeatureContact;
  let fixture: ComponentFixture<DamoclesSwordFeatureContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureContact],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureContact);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
