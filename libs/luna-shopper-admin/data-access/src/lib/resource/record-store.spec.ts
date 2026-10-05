import {
  defineResource,
  type ResourceGateway,
  type ResourceInput,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { RecordStore } from './record-store';

interface Shop extends ResourceRow {
  id: string;
  name: string;
  city: string | null;
  slug: string;
}

const descriptor = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [
    { kind: 'text', name: 'id', label: 'shops.id', editable: false },
    { kind: 'text', name: 'name', label: 'shops.name', required: true },
    { kind: 'text', name: 'city', label: 'shops.city', nullable: true },
    {
      kind: 'text',
      name: 'slug',
      label: 'shops.slug',
      required: true,
      editable: 'create',
    },
  ],
  list: { columns: ['name'], compact: ['name'] },
  errorFields: { slug_taken: 'slug', name_taken: 'name' },
  gateway: () => {
    throw new Error('not used');
  },
});

const row: Shop = { id: 's1', name: 'Centro', city: 'Sevilla', slug: 'centro' };

function refusal(
  code: string,
  status: number,
  fieldErrors?: Record<string, string[]>
): GatewayError {
  return new GatewayError({ code, status, correlationId: '', fieldErrors });
}

/** A gateway that records what it was asked, and answers what a test says. */
function gatewayOf(
  over: Partial<ResourceGateway<ResourceRow>> = {}
): ResourceGateway<ResourceRow> & {
  readonly created: ResourceInput[];
  readonly updated: { id: string; input: ResourceInput }[];
  readonly removed: string[];
} {
  const created: ResourceInput[] = [];
  const updated: { id: string; input: ResourceInput }[] = [];
  const removed: string[] = [];
  // What the server holds. A read after a write answers the written row.
  let held: ResourceRow = row;
  return {
    created,
    updated,
    removed,
    list: async () => ({ items: [], nextCursor: null }),
    read: async () => held,
    create: async (input) => {
      created.push(input);
      return { id: 's_new', ...input };
    },
    update: async (id, input) => {
      updated.push({ id, input });
      held = { ...held, ...input };
      return held;
    },
    remove: async (id) => {
      removed.push(id);
    },
    ...over,
  };
}

async function opened(
  gateway: ResourceGateway<ResourceRow> = gatewayOf()
): Promise<RecordStore<ResourceRow>> {
  const store = new RecordStore<ResourceRow>(descriptor, gateway, 's1');
  await store.load();
  return store;
}

async function adding(
  gateway: ResourceGateway<ResourceRow> = gatewayOf(),
  prefill = {}
): Promise<RecordStore<ResourceRow>> {
  const store = new RecordStore<ResourceRow>(
    descriptor,
    gateway,
    null,
    prefill
  );
  await store.load();
  return store;
}

describe('RecordStore, reading a record', () => {
  it('reads, until it is told to change', async () => {
    const store = new RecordStore<ResourceRow>(descriptor, gatewayOf(), 's1');

    expect(store.mode()).toBe('read');
    expect(store.status()).toBe('loading');

    await store.load();

    expect(store.status()).toBe('ready');
    expect(store.row()).toEqual(row);
    // Reading holds no draft, so nothing can be changed by a slip.
    expect(store.draft()).toEqual({});
    expect(store.changed()).toEqual([]);
  });

  /** "No record has this ID" is an answer, and it is not a failure. */
  it('says a record is missing when the gateway answers 404', async () => {
    const store = await opened(
      gatewayOf({ read: () => Promise.reject(refusal('not_found', 404)) })
    );

    expect(store.status()).toBe('missing');
    expect(store.row()).toBeNull();
    expect(store.error()).toBeNull();
  });

  /** A server that is down has not said the record is gone. */
  it('says the read failed for any other failure, and never "missing"', async () => {
    const store = await opened(
      gatewayOf({ read: () => Promise.reject(refusal('', 0)) })
    );

    expect(store.status()).toBe('error');
    expect(store.error()?.status).toBe(0);
    expect(store.row()).toBeNull();
  });

  /** The frame of a loading page is for a page with nothing to show yet. */
  it('keeps the record on the screen while it is read again', async () => {
    let answer: (value: ResourceRow) => void = () => undefined;
    let reads = 0;
    const store = await opened(
      gatewayOf({
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(row)
            : new Promise<ResourceRow>((resolve) => (answer = resolve));
        },
      })
    );

    const again = store.load();
    expect(store.status()).toBe('ready');
    expect(store.row()).toEqual(row);

    answer({ ...row, name: 'Triana' });
    await again;
    expect(store.row()?.['name']).toBe('Triana');
  });

  it('ignores a change and a save while it reads', async () => {
    const gateway = gatewayOf();
    const store = await opened(gateway);

    store.set('name', 'Triana');
    expect(await store.submit()).toBeNull();

    expect(store.draft()).toEqual({});
    expect(gateway.updated).toEqual([]);
  });
});

describe('RecordStore, changing a record', () => {
  it('starts the draft from the row, with only what the form may change', async () => {
    const store = await opened();

    store.edit();

    expect(store.mode()).toBe('edit');
    // `id` is never editable, and `slug` only while a record is added.
    expect(store.draft()).toEqual({ name: 'Centro', city: 'Sevilla' });
    expect(store.bar()).toEqual({ kind: 'clean' });
  });

  it('throws the draft away on cancel', async () => {
    const store = await opened();
    store.edit();
    store.set('name', 'Triana');

    store.cancel();

    expect(store.mode()).toBe('read');
    expect(store.draft()).toEqual({});
    expect(store.changed()).toEqual([]);
    expect(store.row()).toEqual(row);

    // And the next edit starts from the row again.
    store.edit();
    expect(store.draft()['name']).toBe('Centro');
  });

  it('names the fields that differ from what was read', async () => {
    const store = await opened();
    store.edit();

    store.set('name', 'Triana');
    store.set('city', 'Cadiz');
    expect(store.changed()).toEqual(['name', 'city']);
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 2 });

    // Back to what was read is no change.
    store.set('city', 'Sevilla');
    expect(store.changed()).toEqual(['name']);
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 1 });
  });

  it('goes back to reading the saved row after a save, and says when', async () => {
    const gateway = gatewayOf();
    const store = await opened(gateway);
    store.edit();
    store.set('name', 'Triana');

    const before = Date.now();
    const saved = await store.submit();

    // Only what changed is sent, which is what a change means.
    expect(gateway.updated).toEqual([{ id: 's1', input: { name: 'Triana' } }]);
    expect(saved?.['name']).toBe('Triana');
    expect(store.mode()).toBe('read');
    expect(store.row()?.['name']).toBe('Triana');
    expect(store.savedAt()?.getTime()).toBeGreaterThanOrEqual(before);
    expect(store.draft()).toEqual({});
  });

  it('forgets when it saved once the record is changed again', async () => {
    const store = await opened();
    store.edit();
    store.set('name', 'Triana');
    await store.submit();

    store.edit();

    expect(store.savedAt()).toBeNull();
  });

  it('says "saving" while the save is on its way, and cannot save twice', async () => {
    let answer: (value: ResourceRow) => void = () => undefined;
    let updates = 0;
    const store = await opened(
      gatewayOf({
        update: () => {
          updates += 1;
          return new Promise<ResourceRow>((resolve) => (answer = resolve));
        },
      })
    );
    store.edit();
    store.set('name', 'Triana');

    const first = store.submit();
    expect(store.bar()).toEqual({ kind: 'saving' });
    expect(store.busy()).toBe(true);
    expect(await store.submit()).toBeNull();

    answer({ ...row, name: 'Triana' });
    await first;
    expect(updates).toBe(1);
    expect(store.busy()).toBe(false);
  });
});

/**
 * A write can answer less than a read: the answer of a changed list has no
 * lines and no zone name. The page shows what a read shows.
 */
describe('RecordStore, a save whose answer is smaller than the read', () => {
  const full = { ...row, shelves: ['a', 'b'], chainName: 'Mercado' };

  /** Reads answer the whole row, and a change answers only the columns. */
  const smaller = (over: Partial<ResourceGateway<ResourceRow>> = {}) => {
    let held: ResourceRow = full;
    return gatewayOf({
      read: async () => held,
      update: async (_id, input) => {
        held = { ...held, ...input };
        return { id: 's1', name: held['name'], city: null, slug: 'centro' };
      },
      ...over,
    });
  };

  it('reads the record again, and shows what the read answers', async () => {
    const store = await opened(smaller());
    store.edit();
    store.set('name', 'Triana');

    const saved = await store.submit();

    // The answer of the write is what the caller and the listener get.
    expect(saved).toEqual({
      id: 's1',
      name: 'Triana',
      city: null,
      slug: 'centro',
    });
    expect(store.mode()).toBe('read');
    expect(store.row()).toEqual({ ...full, name: 'Triana' });
    expect(store.savedAt()).not.toBeNull();
    expect(store.draft()).toEqual({});
  });

  it('stays busy, and in the form, until that read answers', async () => {
    let answer: (value: ResourceRow) => void = () => undefined;
    let reads = 0;
    const store = await opened(
      smaller({
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(full)
            : new Promise<ResourceRow>((resolve) => (answer = resolve));
        },
      })
    );
    store.edit();
    store.set('name', 'Triana');

    const saving = store.submit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(store.busy()).toBe(true);
    expect(store.mode()).toBe('edit');
    expect(store.row()).toEqual(full);

    answer({ ...full, name: 'Triana' });
    await saving;

    expect(store.busy()).toBe(false);
    expect(store.mode()).toBe('read');
    expect(store.row()).toEqual({ ...full, name: 'Triana' });
  });

  it('keeps the answer of the write when the read fails, and calls the save a save', async () => {
    let reads = 0;
    const store = await opened(
      smaller({
        read: async () => {
          reads += 1;
          if (reads > 1) {
            throw refusal('internal', 500);
          }
          return full;
        },
      })
    );
    const heard: ResourceRow[] = [];
    store.onSaved((saved) => heard.push(saved));
    store.edit();
    store.set('name', 'Triana');

    const saved = await store.submit();

    expect(saved?.['name']).toBe('Triana');
    expect(store.row()).toEqual(saved);
    expect(store.mode()).toBe('read');
    expect(store.status()).toBe('ready');
    expect(store.error()).toBeNull();
    expect(store.bar()).toEqual({ kind: 'clean' });
    expect(store.savedAt()).not.toBeNull();
    expect(heard).toHaveLength(1);
  });

  it('does not let a read from before the write win over it', async () => {
    const answers: ((value: ResourceRow) => void)[] = [];
    let reads = 0;
    const store = await opened(
      smaller({
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(full)
            : new Promise<ResourceRow>((resolve) => answers.push(resolve));
        },
      })
    );
    store.edit();
    store.set('name', 'Triana');

    const stale = store.load();
    const saving = store.submit();
    await new Promise((resolve) => setTimeout(resolve));
    answers[1]({ ...full, name: 'Triana' });
    await saving;
    answers[0](full);
    await stale;

    expect(store.row()?.['name']).toBe('Triana');
  });
});

describe('RecordStore, a save that is refused', () => {
  /** A rule of this app refuses before the gateway is asked. */
  it('counts the fields the rules of the app refuse, and keeps the draft', async () => {
    const gateway = gatewayOf();
    const store = await opened(gateway);
    store.edit();
    store.set('name', '');

    expect(await store.submit()).toBeNull();

    expect(gateway.updated).toEqual([]);
    expect(store.mode()).toBe('edit');
    expect(store.draft()['name']).toBe('');
    expect(store.invalid()).toEqual(['name']);
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });
    expect(store.messagesFor('name')).toEqual([
      { kind: 'key', key: 'resource.error.required' },
    ]);
  });

  it('puts what the server says about a field under that field', async () => {
    const store = await opened(
      gatewayOf({
        update: () =>
          Promise.reject(
            refusal('validation_failed', 400, { name: ['Too short.'] })
          ),
      })
    );
    store.edit();
    store.set('name', 'T');
    store.set('city', 'Cadiz');

    expect(await store.submit()).toBeNull();

    expect(store.invalid()).toEqual(['name']);
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });
    expect(store.messagesFor('name')).toEqual([
      { kind: 'text', text: 'Too short.' },
    ]);
    // What was typed stays.
    expect(store.draft()).toEqual({ name: 'T', city: 'Cadiz' });
  });

  it('goes back to counting changes once a refused field is changed', async () => {
    const store = await opened(
      gatewayOf({
        update: () =>
          Promise.reject(
            refusal('validation_failed', 400, { name: ['Too short.'] })
          ),
      })
    );
    store.edit();
    store.set('name', 'T');
    store.set('city', 'Cadiz');
    await store.submit();

    // A field that was not refused leaves the bar as it is.
    store.set('city', 'Huelva');
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });

    store.set('name', 'Triana');
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 2 });
    expect(store.messagesFor('name')).toEqual([]);
    expect(store.invalid()).toEqual([]);
  });

  /** A code the descriptor says is about one field counts as that field. */
  it('counts the field a code is about', async () => {
    const store = await opened(
      gatewayOf({
        update: () => Promise.reject(refusal('name_taken', 409)),
      })
    );
    store.edit();
    store.set('name', 'Triana');

    await store.submit();

    expect(store.invalid()).toEqual(['name']);
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });
    expect(store.error()?.code).toBe('name_taken');

    // The server refused the value that was there. It has not seen this one.
    store.set('name', 'Nervion');
    expect(store.error()).toBeNull();
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 1 });
  });

  it('says "refused" for a refusal about no field, until something changes', async () => {
    const store = await opened(
      gatewayOf({ update: () => Promise.reject(refusal('conflict', 409)) })
    );
    store.edit();
    store.set('name', 'Triana');

    await store.submit();

    expect(store.invalid()).toEqual([]);
    expect(store.bar()).toEqual({ kind: 'refused' });
    expect(store.error()?.code).toBe('conflict');
    expect(store.draft()['name']).toBe('Triana');

    store.set('city', 'Cadiz');
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 2 });
  });

  /** A complaint about a field the page does not have has nowhere else to go. */
  it('keeps what the server says about a field it does not know', async () => {
    const store = await opened(
      gatewayOf({
        update: () =>
          Promise.reject(
            refusal('validation_failed', 400, { phone: ['Not a number.'] })
          ),
      })
    );
    store.edit();
    store.set('name', 'Triana');

    await store.submit();

    expect(store.strayErrors()).toEqual(['Not a number.']);
    expect(store.invalid()).toEqual([]);
    expect(store.bar()).toEqual({ kind: 'refused' });
  });
});

describe('RecordStore, adding a record', () => {
  it('is a draft from the first moment, with what a new record can state', async () => {
    const store = await adding();

    expect(store.mode()).toBe('create');
    expect(store.status()).toBe('ready');
    expect(store.row()).toBeNull();
    expect(store.draft()).toEqual({ name: '', city: '', slug: '' });
  });

  it('counts the required fields that are still empty', async () => {
    const store = await adding();

    expect(store.missing()).toEqual(['name', 'slug']);
    expect(store.bar()).toEqual({ kind: 'missing', required: 2 });

    store.set('name', 'Triana');
    expect(store.bar()).toEqual({ kind: 'missing', required: 1 });

    store.set('slug', 'triana');
    expect(store.missing()).toEqual([]);
    expect(store.bar()).toEqual({ kind: 'dirty', changes: 2 });
  });

  /** A value the caller filled in is the baseline: the operator typed nothing. */
  it('opens with what it was handed, and calls that no change', async () => {
    const store = await adding(gatewayOf(), { slug: 'triana', nothing: 'x' });

    expect(store.draft()).toEqual({ name: '', city: '', slug: 'triana' });
    expect(store.changed()).toEqual([]);
    expect(store.missing()).toEqual(['name']);
  });

  /**
   * Every value came with the address and nothing was typed. The record is
   * complete as it opened, so it can be added.
   */
  it('lets a new record be added when nothing is missing and nothing was typed', async () => {
    const gateway = gatewayOf();
    const store = await adding(gateway, { name: 'Triana', slug: 'triana' });

    expect(store.changed()).toEqual([]);
    expect(store.missing()).toEqual([]);
    expect(store.bar()).toEqual({ kind: 'clean', canSave: true });

    await store.submit();
    expect(gateway.created).toHaveLength(1);
  });

  it('does not offer it while a required field is empty', async () => {
    const store = await adding(gatewayOf(), { slug: 'triana' });

    expect(store.bar()).toEqual({ kind: 'missing', required: 1 });
  });

  it('ignores what it was handed when the record exists', async () => {
    const store = new RecordStore<ResourceRow>(descriptor, gatewayOf(), 's1', {
      name: 'Hijacked',
    });
    await store.load();
    store.edit();

    expect(store.draft()['name']).toBe('Centro');
  });

  /**
   * The page leaves for the new record. Nothing changes but the baseline, so
   * that the leave guard does not ask about work that is on the server.
   */
  it('answers the new row and asks nothing more about it', async () => {
    const gateway = gatewayOf();
    const store = await adding(gateway);
    store.set('name', 'Triana');
    store.set('slug', 'triana');

    const saved = await store.submit();

    expect(gateway.created).toEqual([
      { name: 'Triana', city: null, slug: 'triana' },
    ]);
    expect(saved?.['id']).toBe('s_new');
    expect(store.mode()).toBe('create');
    expect(store.savedAt()).toBeNull();
    expect(store.changed()).toEqual([]);
  });

  it('keeps the draft when the gateway refuses the new record', async () => {
    const store = await adding(
      gatewayOf({ create: () => Promise.reject(refusal('slug_taken', 409)) })
    );
    store.set('name', 'Triana');
    store.set('slug', 'centro');

    expect(await store.submit()).toBeNull();

    expect(store.draft()).toEqual({ name: 'Triana', city: '', slug: 'centro' });
    expect(store.invalid()).toEqual(['slug']);
    expect(store.bar()).toEqual({ kind: 'invalid', fields: 1 });
  });

  it('has no reading mode to cancel to, and nothing to delete', async () => {
    const gateway = gatewayOf();
    const store = await adding(gateway);
    store.set('name', 'Triana');

    store.cancel();
    expect(store.mode()).toBe('create');
    expect(store.draft()['name']).toBe('Triana');

    expect(await store.remove()).toBe(false);
    expect(gateway.removed).toEqual([]);
  });
});

describe('RecordStore, a record read twice at once', () => {
  /** Two reads overlap, and the older one answers last. */
  it('applies only the answer of the newest read', async () => {
    const answers: ((value: ResourceRow) => void)[] = [];
    let reads = 0;
    const store = await opened(
      gatewayOf({
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(row)
            : new Promise<ResourceRow>((resolve) => answers.push(resolve));
        },
      })
    );

    const older = store.load();
    const newer = store.load();
    answers[1]({ ...row, name: 'Newer' });
    await newer;
    answers[0]({ ...row, name: 'Older' });
    await older;

    expect(store.row()?.['name']).toBe('Newer');
  });

  it('ignores the failure of a read that a newer one replaced', async () => {
    const pending: {
      resolve: (value: ResourceRow) => void;
      reject: (reason: unknown) => void;
    }[] = [];
    let reads = 0;
    const store = await opened(
      gatewayOf({
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(row)
            : new Promise<ResourceRow>((resolve, reject) =>
                pending.push({ resolve, reject })
              );
        },
      })
    );

    const older = store.load();
    const newer = store.load();
    pending[1].resolve({ ...row, name: 'Newer' });
    await newer;
    pending[0].reject(refusal('internal', 500));
    await older;

    expect(store.status()).toBe('ready');
    expect(store.error()).toBeNull();
    expect(store.row()?.['name']).toBe('Newer');
  });
});

describe('RecordStore, a read that fails under a form', () => {
  const failingSecondRead = () => {
    let reads = 0;
    return gatewayOf({
      read: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve(row)
          : Promise.reject(refusal('internal', 500));
      },
    });
  };

  it('keeps the row, the form and the draft, and says the failure', async () => {
    const store = await opened(failingSecondRead());
    store.edit();
    store.set('name', 'Typed and not saved');

    await store.load();

    expect(store.status()).toBe('ready');
    expect(store.mode()).toBe('edit');
    expect(store.row()).toEqual(row);
    expect(store.draft()['name']).toBe('Typed and not saved');
    expect(store.changed()).toEqual(['name']);
    expect(store.error()?.code).toBe('internal');
  });

  /** Reading holds no draft, so there the page says it has no answer. */
  it('still takes the record away while the page reads', async () => {
    const store = await opened(failingSecondRead());

    await store.load();

    expect(store.status()).toBe('error');
    expect(store.row()).toBeNull();
  });
});

describe('RecordStore, who hears about a save', () => {
  it('tells the listener of a save that went through, with the row', async () => {
    const store = await opened();
    const heard: ResourceRow[] = [];
    store.onSaved((saved) => heard.push(saved));
    store.edit();
    store.set('name', 'Triana');

    await store.submit();

    expect(heard.map((saved) => saved['name'])).toEqual(['Triana']);
  });

  it('tells nobody about a save that was refused, or about a delete', async () => {
    const store = await opened(
      gatewayOf({ update: () => Promise.reject(refusal('conflict', 409)) })
    );
    const heard: ResourceRow[] = [];
    store.onSaved((saved) => heard.push(saved));
    store.edit();
    store.set('name', 'Triana');

    await store.submit();
    store.cancel();
    await store.remove();

    expect(heard).toEqual([]);
  });
});

describe('RecordStore, deleting a record', () => {
  /** A delete is busy, and it is not a save. */
  it('does not let the bar say "saving" while a delete is on its way', async () => {
    let done: () => void = () => undefined;
    const store = await opened(
      gatewayOf({
        remove: () => new Promise<void>((resolve) => (done = resolve)),
      })
    );

    const removing = store.remove();
    expect(store.busy()).toBe(true);
    expect(store.bar().kind).not.toBe('saving');

    done();
    await removing;
    expect(store.busy()).toBe(false);
  });

  it('answers true when the record was deleted', async () => {
    const gateway = gatewayOf();
    const store = await opened(gateway);

    expect(await store.remove()).toBe(true);
    expect(gateway.removed).toEqual(['s1']);
    expect(store.error()).toBeNull();
  });

  it('answers false and holds the refusal when it was not', async () => {
    const store = await opened(
      gatewayOf({ remove: () => Promise.reject(refusal('shop_in_use', 409)) })
    );

    expect(await store.remove()).toBe(false);
    expect(store.error()?.code).toBe('shop_in_use');
    // Still the record, still reading.
    expect(store.status()).toBe('ready');
    expect(store.mode()).toBe('read');
    expect(store.busy()).toBe(false);
  });
});
