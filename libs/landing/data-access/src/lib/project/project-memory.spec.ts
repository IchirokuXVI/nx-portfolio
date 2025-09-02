import { TestBed } from '@angular/core/testing';

import { ProjectMemory } from './project-memory';

describe('ProjectMemory', () => {
  let service: ProjectMemory;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProjectMemory);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
