import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LandingWrapper } from './landing-wrapper';

describe('LandingWrapper', () => {
  let component: LandingWrapper;
  let fixture: ComponentFixture<LandingWrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingWrapper],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingWrapper);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
