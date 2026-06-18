import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TrailerVideo } from './trailer-video';

describe('TrailerVideo', () => {
  let component: TrailerVideo;
  let fixture: ComponentFixture<TrailerVideo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrailerVideo],
    }).compileComponents();

    fixture = TestBed.createComponent(TrailerVideo);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
