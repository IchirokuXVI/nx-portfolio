import {
  defineResource,
  type ResourceGateway,
  type ResourceInput,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { ResourceFormStore } from './resource-form-store';

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
  failWith: unknown = null;
  readFails = false;

  async list() {
    return { items: [], nextCursor: null };
  }

  async read(): Promise<ResourceRow> {
    if (this.readFails) {
      throw new GatewayError({
        code: 'not_found',
        status: 404,
        correlationId: '',
      });
    }
    return row;
  }

  async create(input: ResourceInput): Promise<ResourceRow> {
    if (this.failWith !== null) {
      throw this.failWith;
    }
    this.created.push(input);
    return { ...row, ...input };
  }

  async update(id: string, input: ResourceInput): Promise<ResourceRow> {
    if (this.failWith !== null) {
      throw this.failWith;
    }
    this.updated.push({ id, input });
    return { ...row, ...input };
  }

  async remove(): Promise<void> {
    /* not used */
  }
}

const editStore = (gateway: FakeGateway) =>
  new ResourceFormStore<ResourceRow>(descriptor, gateway, 'edit', 's1');

const createStore = (gateway: FakeGateway) =>
  new ResourceFormStore<ResourceRow>(descriptor, gateway, 'create', null);

describe('ResourceFormStore opening', () => {
  it('an edit starts from the row and is clean', async () => {
    const store = editStore(new FakeGateway());

    await store.load();

    expect(store.status()).toBe('ready');
    expect(store.draft()['price']).toBe('1.20');
    expect(store.dirty()).toBe(false);
  });

  it('a create needs no request and starts empty', async () => {
    const store = createStore(new FakeGateway());

    await store.load();

    expect(store.status()).toBe('ready');
    expect(store.draft()['name']).toEqual({ en: '', es: '' });
  });

  it('reports a row it could not read', async () => {
    const gateway = new FakeGateway();
    gateway.readFails = true;
    const store = editStore(gateway);

    await store.load();

    expect(store.status()).toBe('error');
    expect(store.error()?.code).toBe('not_found');
  });
});

describe('ResourceFormStore messages', () => {
  /**
   * A rule the operator has not had a chance to break yet is not shown. A form
   * that opens covered in complaints teaches an operator to ignore them.
   */
  it('says nothing about a field nobody has touched', async () => {
    const store = createStore(new FakeGateway());
    await store.load();

    expect(store.messagesFor('name')).toEqual([]);
  });

  it('complains once the field has been touched', async () => {
    const store = createStore(new FakeGateway());
    await store.load();

    store.set('name', { en: 'Bonpreu', es: '' });

    expect(store.messagesFor('name')).toEqual([
      {
        kind: 'key',
        key: 'resource.error.missingLocale',
        args: { locale: 'es' },
      },
    ]);
  });

  it('complains about every field once a submit has been attempted', async () => {
    const store = createStore(new FakeGateway());
    await store.load();

    await store.submit();

    expect(store.messagesFor('name')).toHaveLength(2);
    expect(store.valid()).toBe(false);
  });

  it('refuses to send a draft its own rules reject', async () => {
    const gateway = new FakeGateway();
    const store = createStore(gateway);
    await store.load();

    const saved = await store.submit();

    expect(saved).toBeNull();
    expect(gateway.created).toEqual([]);
  });
});

describe('ResourceFormStore server errors', () => {
  const refusal = new GatewayError({
    code: 'validation_failed',
    status: 400,
    correlationId: 'abc',
    fieldErrors: {
      websiteUrl: ['That is not a reachable address.'],
      operatingCompanyId: ['must be a uuid'],
    },
  });

  /** Section 5: back on the field that caused it, not dumped in a banner. */
  it('lands a field error on its field', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = refusal;
    const store = editStore(gateway);
    await store.load();
    store.set('websiteUrl', 'https://bonpreu.cat');

    await store.submit();

    expect(store.messagesFor('websiteUrl')).toEqual([
      { kind: 'text', text: 'That is not a reachable address.' },
    ]);
  });

  /**
   * There is nowhere else for a complaint about a field this form does not
   * have, and dropping it would leave a refused submit with no reason on screen.
   */
  it('keeps a complaint about a field it does not have', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = refusal;
    const store = editStore(gateway);
    await store.load();
    store.set('websiteUrl', 'https://bonpreu.cat');

    await store.submit();

    expect(store.strayErrors()).toEqual(['must be a uuid']);
  });

  /**
   * The server refused the value that was there; it has not seen this one.
   * Leaving the message under a field the operator has just corrected is how a
   * form ends up arguing with somebody who already did what it asked.
   */
  it('drops a field error the moment that field is changed again', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = refusal;
    const store = editStore(gateway);
    await store.load();
    store.set('websiteUrl', 'https://bonpreu.cat');
    await store.submit();

    store.set('websiteUrl', 'https://www.bonpreu.cat');

    expect(store.messagesFor('websiteUrl')).toEqual([]);
  });

  it('keeps everything typed when a submit is refused', async () => {
    const gateway = new FakeGateway();
    gateway.failWith = refusal;
    const store = editStore(gateway);
    await store.load();
    store.set('websiteUrl', 'https://bonpreu.cat');

    await store.submit();

    expect(store.draft()['websiteUrl']).toBe('https://bonpreu.cat');
    expect(store.dirty()).toBe(true);
  });
});

describe('ResourceFormStore submitting', () => {
  it('sends only what changed on an edit', async () => {
    const gateway = new FakeGateway();
    const store = editStore(gateway);
    await store.load();
    store.set('price', '1.50');

    await store.submit();

    expect(gateway.updated).toEqual([{ id: 's1', input: { price: '1.50' } }]);
  });

  /**
   * The rule of section 5. `unitPrice` is stored verbatim: the obvious
   * derivation disagrees with the source on 110 of 4,232 products, in the field
   * whose only purpose is comparison.
   */
  it('derives nothing: changing the price leaves the unit price alone', async () => {
    const gateway = new FakeGateway();
    const store = editStore(gateway);
    await store.load();
    store.set('price', '9.99');

    await store.submit();

    expect(Object.keys(gateway.updated[0].input)).toEqual(['price']);
    expect(store.draft()['unitPrice']).toBe('1.2000');
  });

  it('is clean again once the save lands', async () => {
    const store = editStore(new FakeGateway());
    await store.load();
    store.set('price', '1.50');

    await store.submit();

    expect(store.dirty()).toBe(false);
  });

  it('submits a localized name as an object', async () => {
    const gateway = new FakeGateway();
    const store = createStore(gateway);
    await store.load();
    store.set('name', { en: 'Bonpreu', es: 'Bonpreu' });

    await store.submit();

    expect(gateway.created[0]['name']).toEqual({
      en: 'Bonpreu',
      es: 'Bonpreu',
    });
  });
});
