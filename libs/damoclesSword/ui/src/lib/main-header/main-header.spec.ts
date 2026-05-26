import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { MainHeader } from './main-header';

describe('MainHeader', () => {
  let component: MainHeader;
  let fixture: ComponentFixture<MainHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainHeader, RouterModule.forRoot([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MainHeader);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
