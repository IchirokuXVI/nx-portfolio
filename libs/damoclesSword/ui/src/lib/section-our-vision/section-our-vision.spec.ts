import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionOurVision } from './section-our-vision';

describe('SectionOurVision', () => {
  let component: SectionOurVision;
  let fixture: ComponentFixture<SectionOurVision>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionOurVision],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionOurVision);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
