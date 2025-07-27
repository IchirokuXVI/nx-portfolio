import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Odontogram } from './odontogram';

describe('Odontogram', () => {
  let component: Odontogram;
  let fixture: ComponentFixture<Odontogram>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Odontogram],
    }).compileComponents();

    fixture = TestBed.createComponent(Odontogram);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
