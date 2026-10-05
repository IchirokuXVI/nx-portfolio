import {
  defineResource,
  type ResourceGateway,
  type ResourceInput,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { RecordStore } from './record-store';

/**
 * What a draft says and what it sends (admin plan 0060).
 *
 * These cases were the old form's, in the spec of the store that went with
 * it. The rules they hold are the rules of `models`, and `RecordStore` is the
 * one store that applies them now, so they are kept here against it. The
 * states of the store and its bar are in `record-store.spec.ts`.
 */

interface Shop extends ResourceRow {
  id: string;
  name: Record<string, string>;
  websiteUrl: string | null;
  price: string | null;
  unitPrice: string | null;
}

const descriptor = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.id,
  fields: [
    { kind: 'text', name: 'id', label: 'shops.id', editable: false },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'shops.name',
      locales: ['en', 'es'],
      required: true,
    },
    {
      kind: 'text',
      name: 'websiteUrl',
      label: 'shops.website',
      format: 'url',
      nullable: true,
    },
    {
      kind: 'money',
      name: 'price',
      label: 'shops.price',
      decimals: 2,
      nullable: true,
    },
    {
      kind: 'money',
      name: 'unitPrice',
      label: 'shops.unitPrice',
      decimals: 4,
      nullable: true,
    },
  ],
  list: { columns: ['name'], compact: ['name'] },
  actions: { create: true, edit: true },
  gateway: () => {
    throw new Error('not used');
  },
});

const row: Shop = {
  id: 's1',
  name: { en: 'Bonpreu', es: 'Bonpreu' },
  websiteUrl: 'https://bonpreu.example',
  price: '1.20',
  unitPrice: '1.2000',
};

class FakeGateway implements ResourceGateway<ResourceRow> {
  readonly created: ResourceInput[] = [];
  readonly updated: { id: string; input: ResourceInput }[] = [];

  async list() {
    return { items: [], nextCursor: null };
  }

  async read(): Promise<ResourceRow> {
    return row;
  }

  async create(input: ResourceInput): Promise<ResourceRow> {
    this.created.push(input);
    return { ...row, ...input };
  }

  async update(id: string, input: ResourceInput): Promise<ResourceRow> {
    this.updated.push({ id, input });
    return { ...row, ...input };
  }

  async remove(): Promise<void> {
    /* not used */
  }
}

/** A record that exists, read and then opened as a form. */
async function changing(gateway: FakeGateway) {
  const store = new RecordStore<ResourceRow>(descriptor, gateway, 's1');
  await store.load();
  store.edit();
  return store;
}

/** A record that does not exist yet. */
async function adding(gateway: FakeGateway, prefill = {}) {
  const store = new RecordStore<ResourceRow>(
    descriptor,
    gateway,
    null,
    prefill
  );
  await store.load();
  return store;
}

describe('RecordStore, what it says under a field', () => {
  /**
   * A rule the operator has not had a chance to break yet is not shown. A form
   * that opens covered in complaints teaches an operator to ignore them.
   */
  it('says nothing about a field nobody has touched', async () => {
    const store = await adding(new FakeGateway());

    expect(store.messagesFor('name')).toEqual([]);
  });

  it('complains once the field has been touched', async () => {
    const store = await adding(new FakeGateway());

    store.set('name', { en: '', es: '' });

    expect(store.messagesFor('name')).toEqual([
      { kind: 'key', key: 'resource.error.missingAnyLocale' },
    ]);
  });

  /** A name in one language is a whole name (plan 0079). */
  it('says nothing about a name that has one of its languages', async () => {
    const store = await adding(new FakeGateway());

    store.set('name', { en: 'Bonpreu', es: '' });

    expect(store.messagesFor('name')).toEqual([]);
  });

  it('complains about every field once a save was tried, and sends nothing', async () => {
    const gateway = new FakeGateway();
    const store = await adding(gateway);

    const saved = await store.submit();

    expect(saved).toBeNull();
    expect(store.messagesFor('name')).toHaveLength(1);
    expect(gateway.created).toEqual([]);
  });
});

describe('RecordStore, what it sends', () => {
  it('sends only what changed on a record that exists', async () => {
    const gateway = new FakeGateway();
    const store = await changing(gateway);
    store.set('price', '1.50');

    await store.submit();

    expect(gateway.updated).toEqual([{ id: 's1', input: { price: '1.50' } }]);
  });

  /**
   * `unitPrice` is stored as it was typed: the obvious division disagrees
   * with the source on 110 of 4,232 products, in the field whose only purpose
   * is comparison. So a change of the price changes the price, and no field
   * is worked out from another one.
   */
  it('derives nothing: changing the price leaves the unit price alone', async () => {
    const gateway = new FakeGateway();
    const store = await changing(gateway);
    store.set('price', '9.99');

    expect(store.draft()['unitPrice']).toBe('1.2000');
    await store.submit();

    expect(Object.keys(gateway.updated[0].input)).toEqual(['price']);
  });

  it('sends a text in several languages as an object', async () => {
    const gateway = new FakeGateway();
    const store = await adding(gateway);
    store.set('name', { en: 'Bonpreu', es: 'Bonpreu' });

    await store.submit();

    expect(gateway.created[0]['name']).toEqual({
      en: 'Bonpreu',
      es: 'Bonpreu',
    });
  });
});

describe('RecordStore, what a new record is handed', () => {
  /** A caller cannot widen what a new record sends. */
  it('ignores a name the descriptor does not let a new record state', async () => {
    const store = await adding(new FakeGateway(), {
      id: 'forged',
      nonsense: 'x',
    });

    expect(store.draft()['id']).toBeUndefined();
    expect(store.draft()['nonsense']).toBeUndefined();
  });
});
