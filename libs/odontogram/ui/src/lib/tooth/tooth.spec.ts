import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tooth } from './tooth';

describe('Tooth', () => {
  let component: Tooth;
  let fixture: ComponentFixture<Tooth>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tooth],
    }).compileComponents();

    fixture = TestBed.createComponent(Tooth);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
