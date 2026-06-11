import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureServices } from './feature-services';

describe('FeatureServices', () => {
  let component: FeatureServices;
  let fixture: ComponentFixture<FeatureServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureServices],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureServices);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
