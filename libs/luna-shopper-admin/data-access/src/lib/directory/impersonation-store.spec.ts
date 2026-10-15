import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AdminSession } from '@portfolio/luna-shopper-admin/models';
import { SessionStore } from '../auth/session-store';
import { DIRECTORY_SERVICE, type DirectoryServiceI } from './directory-service';
import { ImpersonationStore } from './impersonation-store';

/**
 * The switch of support sessions, read one time for the session of the
 * operator (admin plan 0062, target state 1).
 */

function setUp(
  answer: () => Promise<boolean>,
  session?: ReturnType<typeof signal<Pick<AdminSession, 'adminId'> | null>>
) {
  let reads = 0;
  const directory = {
    impersonationEnabled: () => {
      reads += 1;
      return answer();
    },
  } as Partial<DirectoryServiceI> as DirectoryServiceI;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DIRECTORY_SERVICE, useValue: directory },
      ...(session === undefined
        ? []
        : [{ provide: SessionStore, useValue: { session } }]),
    ],
  });

  return { store: TestBed.inject(ImpersonationStore), reads: () => reads };
}

describe('ImpersonationStore', () => {
  it('is off until the read says otherwise', async () => {
    const { store } = setUp(async () => true);

    expect(store.enabled()).toBe(false);
    await store.load();
    expect(store.enabled()).toBe(true);
  });

  it('reads one time however often it is asked', async () => {
    const { store, reads } = setUp(async () => true);

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(reads()).toBe(1);
  });

  it('counts a failed read as off', async () => {
    const { store } = setUp(async () => {
      throw new Error('offline');
    });

    await store.load();

    expect(store.enabled()).toBe(false);
  });

  it('reads nothing while nobody is signed in', async () => {
    const session = signal<Pick<AdminSession, 'adminId'> | null>(null);
    const { store, reads } = setUp(async () => true, session);

    await store.load();

    expect(reads()).toBe(0);
    expect(store.enabled()).toBe(false);
  });

  it('asks again for the next operator, and offers nothing until then', async () => {
    const session = signal<Pick<AdminSession, 'adminId'> | null>({
      adminId: 'a-1',
    });
    const { store, reads } = setUp(async () => true, session);
    await store.load();
    expect(store.enabled()).toBe(true);

    session.set({ adminId: 'a-2' });
    expect(store.enabled()).toBe(false);

    await store.load();
    expect(store.enabled()).toBe(true);
    expect(reads()).toBe(2);
  });
});
