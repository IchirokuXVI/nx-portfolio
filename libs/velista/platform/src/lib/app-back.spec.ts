import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppBack } from './app-back';
import { AppHistory } from './app-history';
import { BackStack } from './back-stack';

describe('AppBack', () => {
  let behind: boolean;
  let back: jest.Mock;
  let navigateByUrl: jest.Mock;

  beforeEach(() => {
    behind = false;
    back = jest.fn();
    navigateByUrl = jest.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        // A hand built double: the only question `AppBack` asks of the history is
        // whether the entry behind is one of ours.
        {
          provide: AppHistory,
          useValue: { hasEntryBehind: () => behind },
        },
        { provide: Location, useValue: { back } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
  });

  it('is handled when something on screen takes the press, and nothing pops', () => {
    behind = true;
    TestBed.inject(BackStack).register(() => true);

    expect(TestBed.inject(AppBack).request()).toBe('handled');
    expect(back).not.toHaveBeenCalled();
  });

  it('pops once when nothing takes it and the entry behind is ours', () => {
    behind = true;
    TestBed.inject(BackStack).register(() => false);

    expect(TestBed.inject(AppBack).request()).toBe('popped');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('reaches the floor when nothing takes it and nothing of ours is behind', () => {
    expect(TestBed.inject(AppBack).request()).toBe('floor');
    expect(back).not.toHaveBeenCalled();
    // The floor is the caller's, so nothing walks to a fallback on its behalf.
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
