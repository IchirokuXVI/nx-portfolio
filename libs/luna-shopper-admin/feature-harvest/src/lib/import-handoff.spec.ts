import { TestBed } from '@angular/core/testing';
import { ImportHandoff } from './import-handoff';

/**
 * A file on its way from the Runs tab to the import page (admin plan 0044,
 * target 5).
 */
describe('ImportHandoff', () => {
  const file = (name: string) => ({ name }) as unknown as File;

  function build(): ImportHandoff {
    TestBed.resetTestingModule();
    return TestBed.inject(ImportHandoff);
  }

  it('holds nothing until a file is left', () => {
    expect(build().take()).toBeNull();
  });

  it('gives back the file that was left', () => {
    const handoff = build();
    const left = file('leaflet.json');

    handoff.leave(left);

    expect(handoff.take()).toBe(left);
  });

  /**
   * Taken once. A later visit to the import page by its address starts with
   * no file, which is what that address has always meant.
   */
  it('is empty after the file was taken', () => {
    const handoff = build();
    handoff.leave(file('leaflet.json'));

    handoff.take();

    expect(handoff.take()).toBeNull();
  });

  it('keeps the last file when two were left', () => {
    const handoff = build();
    const second = file('second.json');
    handoff.leave(file('first.json'));
    handoff.leave(second);

    expect(handoff.take()).toBe(second);
  });

  /** The page that takes the file is built after the tab that left it is gone. */
  it('is one instance for the whole app', () => {
    const handoff = build();
    const left = file('leaflet.json');
    handoff.leave(left);

    expect(TestBed.inject(ImportHandoff).take()).toBe(left);
  });
});
