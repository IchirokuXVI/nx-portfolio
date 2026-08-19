import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DetailSection } from './detail-section';

@Component({
  imports: [DetailSection],
  template: `
    <lib-landing-v2-detail-section
      [heading]="'Overview'"
      [open]="open"
      [sectionId]="'overview'"
    >
      <p lead>LEAD COPY</p>
      <p deep>DEEP COPY</p>
    </lib-landing-v2-detail-section>
  `,
})
class Host {
  open = false;
}

describe('DetailSection', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
  });

  it('renders the heading and exposes the section id as an anchor', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.detail-section__heading')?.textContent).toBe(
      'Overview'
    );
    expect(host.querySelector('#overview')).not.toBeNull();
  });

  it('always renders the lead', () => {
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.detail-section__lead')?.textContent).toContain(
      'LEAD COPY'
    );
  });

  it('hides the deep block until open is set', () => {
    fixture.detectChanges();
    let host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-section__deep')).toBeNull();

    fixture.componentInstance.open = true;
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.detail-section__deep')?.textContent).toContain(
      'DEEP COPY'
    );
  });
});
