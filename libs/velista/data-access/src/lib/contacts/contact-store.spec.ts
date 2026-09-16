import { TestBed } from '@angular/core/testing';
import { ContactMemory } from './contact-memory';
import { CONTACT_SERVICE } from './contact-service';
import { ContactStore } from './contact-store';

/** The contacts behind the people picker (velista `0085`, section 2). */
function harness(memory = new ContactMemory()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [ContactStore, { provide: CONTACT_SERVICE, useValue: memory }],
  });
  return { store: TestBed.inject(ContactStore), memory };
}

describe('ContactStore', () => {
  it('follows the cursor to the end', async () => {
    // The memory pages two at a time and holds three memberships.
    const { store } = harness();

    await store.load();

    expect(store.state()).toBe('loaded');
    expect(store.contacts()).toHaveLength(3);
  });

  it('keeps what it holds when a later read fails', async () => {
    const { store, memory } = harness();
    await store.load();

    memory.listContacts = () => Promise.reject(new Error('offline'));
    await store.load();

    expect(store.state()).toBe('loaded');
    expect(store.contacts()).toHaveLength(3);
  });

  it('reports a first read that failed', async () => {
    const memory = new ContactMemory();
    memory.listContacts = () => Promise.reject(new Error('offline'));
    const { store } = harness(memory);

    await store.load();

    expect(store.state()).toBe('failed');
  });

  it('shares one read between two sheets opening together', async () => {
    const memory = new ContactMemory();
    const listContacts = jest.spyOn(memory, 'listContacts');
    const { store } = harness(memory);

    await Promise.all([store.load(), store.load()]);

    // Two pages, once each: not four.
    expect(listContacts).toHaveBeenCalledTimes(2);
  });
});
