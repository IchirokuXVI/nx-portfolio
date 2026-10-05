import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  draftFor,
  isEditable,
  recordLayout,
  toInput,
  validateDraft,
  type EnumField,
  type NamedAction,
  type ReferenceField,
  type ResourceRow,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChainNames } from './chain-names';
import { SOURCES } from './sources';
import { SourcesGateway, type Source } from './sources-gateway';

/**
 * The chain sources as a resource (admin plan 0059, section 3): what the
 * descriptor claims, and what its gateway does with `HARVEST_SERVICE`.
 *
 * The harvester is the in-memory one, so a write is read back from it and
 * not from a spy alone. The translator double answers a key with the key.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
/** A chain the seed gives no source. */
const NEW_CHAIN = '99999999-9999-4999-8999-999999999999';

type View = Wire.HarvestSupermarketSourceView;

function setup(names: Readonly<Record<string, string>> = {}) {
  const harvest = new HarvestMemory();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      { provide: HARVEST_SERVICE, useValue: harvest },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
      {
        provide: ChainNames,
        useValue: {
          resolve: async () => undefined,
          known: (id: string) => names[id] ?? null,
        },
      },
    ],
  });

  const gateway = TestBed.inject(SourcesGateway);
  const actions = TestBed.runInInjectionContext(
    () => SOURCES.actions?.named?.() ?? []
  );
  return { harvest, gateway, actions };
}

const field = (name: string) => {
  const found = SOURCES.fields.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`SOURCES has no field "${name}"`);
  }
  return found;
};

function source(over: Partial<Source> = {}): Source {
  return {
    id: 'row-1',
    supermarketId: MERCADONA,
    adapterKey: 'mercadona-api',
    enabled: false,
    autoImportPlaces: false,
    config: {},
    workers: 4,
    maxRequestsPerSecond: 2,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    chainName: 'Mercadona',
    ...over,
  };
}

describe('SOURCES, the descriptor', () => {
  it('names a field for each column, and draws a card from its columns', () => {
    const named = new Set(SOURCES.fields.map((candidate) => candidate.name));
    const columns = new Set(SOURCES.list.columns);

    expect(SOURCES.list.columns).toEqual([
      'supermarketId',
      'adapterKey',
      'lastRunAt',
      'consecutiveFailures',
    ]);
    for (const column of SOURCES.list.columns) {
      expect([column, named.has(column)]).toEqual([column, true]);
    }
    expect(SOURCES.list.compact).toEqual(['supermarketId', 'adapterKey']);
    for (const compact of SOURCES.list.compact) {
      expect([compact, columns.has(compact)]).toEqual([compact, true]);
    }
  });

  it('is addressed by the ID of its chain', () => {
    expect(SOURCES.rowId?.(source({ id: 'row-9' }))).toBe(MERCADONA);
  });

  /** The chain is chosen once: an upsert of another chain writes a second row. */
  it('takes the chain when it is added, and never afterwards', () => {
    const chain = field('supermarketId') as ReferenceField<ResourceRow>;

    expect(chain.kind).toBe('reference');
    expect(chain.resource).toBe('supermarkets');
    expect(chain.required).toBe(true);
    expect(chain.nameLookup).toBe(true);
    // No empty choice: the column takes no null.
    expect(chain.nullable).toBeUndefined();
    expect(chain.emptyOption).toBeUndefined();
    expect(isEditable(chain, 'create')).toBe(true);
    expect(isEditable(chain, 'edit')).toBe(false);
  });

  /**
   * The picker offers what the upsert accepts, read out of the generated
   * types. `osm-places` stays in the view because old rows hold it, and the
   * upsert no longer takes it.
   */
  it('offers every adapter the document declares, and no OpenStreetMap', () => {
    const wire = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'models',
        'src',
        'lib',
        'wire',
        'wire-types.ts'
      ),
      'utf8'
    );
    const union =
      /export type UpsertSupermarketSourceDto = \{\s*adapterKey:([^;]+);/.exec(
        wire
      );
    const declared = [...(union?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (match) => match[1]
    );

    const adapter = field('adapterKey') as EnumField<ResourceRow>;
    const offered = adapter.options.map((option) => option.value);

    expect(declared.length).toBeGreaterThan(4);
    expect([...offered].sort()).toEqual([...declared].sort());
    expect(offered).not.toContain('osm-places');
    expect(adapter.required).toBe(true);
    for (const option of adapter.options) {
      expect(option.label).toBe(`harvest.sources.adapter.${option.value}`);
    }
  });

  it('holds the two numbers to the limits of the route', () => {
    expect(field('workers')).toMatchObject({
      kind: 'number',
      integer: true,
      min: 1,
      max: 64,
    });
    expect(field('maxRequestsPerSecond')).toMatchObject({
      kind: 'number',
      min: 0.1,
      max: 100,
    });
  });

  /** Target 4: whether a chain may be fetched is read, and never a control. */
  it('reads whether a chain may be fetched, and says where it is changed', () => {
    const enabled = field('enabled');

    expect(enabled.kind).toBe('boolean');
    expect(isEditable(enabled, 'create')).toBe(false);
    expect(isEditable(enabled, 'edit')).toBe(false);
    expect(enabled.setBy).toBe('harvest.sources.enabledSetBy');
    expect(enabled.help).toBe('harvest.sources.help.enabled');
    // The one field of the back office whose help is drawn while it is read.
    expect(enabled.helpWhenRead).toBe(true);
  });

  /** Target 5: a switch of the form, saved with Save. */
  it('changes "places are added with no review" with the form', () => {
    const trusted = field('autoImportPlaces');

    expect(trusted.kind).toBe('boolean');
    expect(isEditable(trusted, 'edit')).toBe(true);
    expect(trusted.help).toBe('harvest.sources.help.autoImportPlaces');
  });

  it('keeps the config one box of JSON', () => {
    expect(field('config').kind).toBe('json');
    expect(isEditable(field('config'), 'edit')).toBe(true);
  });

  it('never lets the form change what a run wrote', () => {
    for (const name of ['lastRunAt', 'lastSuccessAt', 'consecutiveFailures']) {
      expect([name, isEditable(field(name), 'edit')]).toEqual([name, false]);
      expect([name, isEditable(field(name), 'create')]).toEqual([name, false]);
    }
    expect(field('lastRunAt')).toMatchObject({ kind: 'date', time: true });
    expect(field('lastSuccessAt')).toMatchObject({ kind: 'date', time: true });
  });

  /** The form never sends `enabled`, whatever the draft holds. */
  it('never puts `enabled` in what the form sends', () => {
    const row = source({ enabled: true });

    const original = draftFor(SOURCES, row, 'edit');
    const changed = toInput(
      SOURCES,
      { ...original, enabled: false, workers: '8' },
      'edit',
      original
    );
    expect(changed).toEqual({ workers: 8 });

    const added = toInput(
      SOURCES,
      {
        ...draftFor(SOURCES, null, 'create'),
        supermarketId: NEW_CHAIN,
        adapterKey: 'manual',
        enabled: true,
      },
      'create',
      {}
    );
    expect(added).not.toHaveProperty('enabled');
    expect(added).toMatchObject({
      supermarketId: NEW_CHAIN,
      adapterKey: 'manual',
    });
  });

  /**
   * The help says "An empty box means no settings at all". The box was left
   * out of what the form sent, so the gateway put the old settings back and
   * the save said it went through.
   */
  it('an emptied box is saved as no settings at all', async () => {
    const { gateway, harvest } = setup();
    await harvest.upsertSource(MERCADONA, {
      adapterKey: 'mercadona-api',
      config: { warehouse: 'mad1' },
    });
    const row: Source = {
      ...(await harvest.readSource(MERCADONA)),
      chainName: 'Mercadona',
    };
    const upsert = jest.spyOn(harvest, 'upsertSource');

    const original = draftFor(SOURCES, row, 'edit');
    const draft = { ...original, config: '' };

    expect(validateDraft(SOURCES, draft, 'edit', original)).toEqual({});
    const input = toInput(SOURCES, draft, 'edit', original);
    expect(input).toEqual({ config: {} });

    const saved = await gateway.update(MERCADONA, input);

    expect(upsert.mock.calls[0][1]).toMatchObject({ config: {} });
    expect(saved.config).toEqual({});
  });

  /**
   * Neither column takes a null. An emptied box was left out of what the
   * form sent, so the old number was kept and nothing said so.
   */
  it('refuses an emptied workers or rate box, under the box', () => {
    const original = draftFor(SOURCES, source(), 'edit');

    expect(
      validateDraft(
        SOURCES,
        { ...original, workers: '', maxRequestsPerSecond: '' },
        'edit',
        original
      )
    ).toEqual({
      workers: [{ kind: 'key', key: 'resource.error.required' }],
      maxRequestsPerSecond: [{ kind: 'key', key: 'resource.error.required' }],
    });
  });

  it('is headed by the name of its chain', () => {
    expect(SOURCES.title(source(), [])).toBe('Mercadona');
  });

  /** Never by an ID: a uuid in a heading says nothing to a person. */
  it('is headed by its adapter when the chain cannot be named', () => {
    expect(SOURCES.title(source({ chainName: null }), [])).toBe(
      'mercadona-api'
    );
  });

  it('says "Fetched" in the good tone, or "Off" in the neutral one', () => {
    const states = TestBed.runInInjectionContext(
      () => SOURCES.rowStates?.() ?? (() => [])
    );

    expect(states(source({ enabled: true }))).toEqual([
      { label: 'harvest.sources.state.fetched', tone: 'good' },
    ]);
    expect(states(source({ enabled: false }))).toEqual([
      { label: 'harvest.sources.state.off', tone: 'neutral' },
    ]);
  });

  /**
   * What a delete costs, said before it: no fetching run for the chain until
   * a source is added again, and the runs it has done are kept.
   */
  it('says before a delete what the chain loses and what is kept', () => {
    expect(SOURCES.record?.deleteBody).toBe('harvest.sources.deleteBody');
  });

  it('can be added, changed and deleted', () => {
    expect(SOURCES.actions).toMatchObject({
      create: true,
      edit: true,
      delete: true,
    });
  });

  it('carries the caution about asking too fast, for the form', () => {
    expect(SOURCES.caution).toBe('harvest.sources.caution');
  });

  describe('the record page', () => {
    it('reads three sections, and "may be fetched" in the last', () => {
      const layout = recordLayout(SOURCES, 'read');

      expect(
        layout.sections.map((section) => [
          section.title,
          section.fields.map((candidate) => candidate.name),
        ])
      ).toEqual([
        ['harvest.sources.section.source', ['supermarketId', 'adapterKey']],
        ['harvest.sources.section.speed', ['workers', 'maxRequestsPerSecond']],
        [
          'harvest.sources.section.may',
          ['enabled', 'autoImportPlaces', 'config'],
        ],
      ]);
    });

    /** A new source cannot state whether it may be fetched: it may not. */
    it('adds a source with no "may be fetched"', () => {
      const names = recordLayout(SOURCES, 'create').sections.flatMap(
        (section) => section.fields.map((candidate) => candidate.name)
      );

      expect(names).toEqual([
        'supermarketId',
        'adapterKey',
        'workers',
        'maxRequestsPerSecond',
        'autoImportPlaces',
        'config',
      ]);
    });

    /** The view carries no date of its own making, so there is no "Added". */
    it('holds the runs in the Record block, and no "Added"', () => {
      const facts = recordLayout(SOURCES, 'read').facts;

      expect(facts.added).toBeNull();
      expect(facts.changed).toBeNull();
      expect(facts.also.map((candidate) => candidate.name)).toEqual([
        'lastRunAt',
        'lastSuccessAt',
        'consecutiveFailures',
      ]);
    });
  });
});

describe('SOURCES, the two named actions', () => {
  const named = (actions: readonly NamedAction<Source>[], name: string) => {
    const found = actions.find((action) => action.name === name);
    if (found === undefined) {
      throw new Error(`no action "${name}"`);
    }
    return found;
  };

  it('offers the one that fits the state of the row, and never both', () => {
    const { actions } = setup();
    const offered = (row: Source) =>
      actions
        .filter((action) => action.available?.(row) !== false)
        .map((action) => action.name);

    expect(offered(source({ enabled: true }))).toEqual(['stop-fetching']);
    expect(offered(source({ enabled: false }))).toEqual(['allow-fetching']);
  });

  /** Neither destroys: each is taken back by the other. */
  it('asks before each, and marks neither as a danger', () => {
    const { actions } = setup();

    expect(actions.map((action) => action.name)).toEqual([
      'stop-fetching',
      'allow-fetching',
    ]);
    for (const action of actions) {
      expect(action.confirm).toBeDefined();
      expect(action.danger).toBeUndefined();
      expect(action.after).toBeUndefined();
    }
    expect(named(actions, 'stop-fetching').confirm).toEqual({
      heading: 'harvest.sources.confirm.stop.heading',
      body: 'harvest.sources.confirm.stop.body',
      confirm: 'harvest.sources.confirm.stop.confirm',
    });
  });

  it('writes through the route of its own, and resends no configuration', async () => {
    const { actions, harvest } = setup();
    const set = jest.spyOn(harvest, 'setSourceEnabled');
    const upsert = jest.spyOn(harvest, 'upsertSource');
    const before = await harvest.readSource(MERCADONA);

    await named(actions, 'allow-fetching').run(
      source({ supermarketId: MERCADONA, enabled: false })
    );
    expect(set).toHaveBeenLastCalledWith(MERCADONA, true);
    expect((await harvest.readSource(MERCADONA)).enabled).toBe(true);

    await named(actions, 'stop-fetching').run(
      source({ supermarketId: MERCADONA, enabled: true })
    );
    expect(set).toHaveBeenLastCalledWith(MERCADONA, false);
    expect((await harvest.readSource(MERCADONA)).enabled).toBe(false);

    expect(upsert).not.toHaveBeenCalled();
    expect((await harvest.readSource(MERCADONA)).workers).toBe(before.workers);
  });
});

describe('SourcesGateway', () => {
  it('lists the sources with the cursor it was given, each with its chain named', async () => {
    const { gateway, harvest } = setup({ [MERCADONA]: 'Mercadona' });
    const list = jest.spyOn(harvest, 'listSources');

    const page = await gateway.list({ cursor: undefined, limit: 25 });

    expect(list).toHaveBeenCalledWith({ cursor: undefined, limit: 25 });
    const mercadona = page.items.find((row) => row.supermarketId === MERCADONA);
    expect(mercadona?.chainName).toBe('Mercadona');
    // A chain the lookup cannot name has no name, and never its ID as one.
    for (const row of page.items.filter(
      (candidate) => candidate.supermarketId !== MERCADONA
    )) {
      expect(row.chainName).toBeNull();
    }
    expect(gateway.listFailed()).toBe(false);
  });

  it('reads one source by the ID of its chain', async () => {
    const { gateway, harvest } = setup({ [MERCADONA]: 'Mercadona' });
    const read = jest.spyOn(harvest, 'readSource');

    const row = await gateway.read(MERCADONA);

    expect(read).toHaveBeenCalledWith(MERCADONA);
    expect(row.supermarketId).toBe(MERCADONA);
    expect(row.chainName).toBe('Mercadona');
  });

  /**
   * The route is an upsert, so a create for a chain with a source would
   * rewrite a configuration nobody was looking at.
   */
  it('refuses to add a source for a chain that has one, and writes nothing', async () => {
    const { gateway, harvest } = setup();
    const upsert = jest.spyOn(harvest, 'upsertSource');
    const before = await harvest.readSource(MERCADONA);

    const refused = await gateway
      .create({ supermarketId: MERCADONA, adapterKey: 'manual', workers: 60 })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect(refused).toBeInstanceOf(GatewayError);
    // Under the chain, as the server refuses a field.
    expect((refused as GatewayError).fieldErrors).toEqual({
      supermarketId: ['harvest.sources.exists'],
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(await harvest.readSource(MERCADONA)).toEqual(before);
  });

  it('adds a source for a chain with none, with fetching off', async () => {
    const { gateway, harvest } = setup();
    const upsert = jest.spyOn(harvest, 'upsertSource');

    const created = await gateway.create({
      supermarketId: NEW_CHAIN,
      adapterKey: 'deza-web',
      workers: 2,
      maxRequestsPerSecond: 0.5,
      autoImportPlaces: false,
      config: { detailBudget: 10 },
      // A caller that tried anyway: it is not sent.
      enabled: true,
    });

    expect(upsert).toHaveBeenCalledWith(NEW_CHAIN, {
      adapterKey: 'deza-web',
      workers: 2,
      maxRequestsPerSecond: 0.5,
      autoImportPlaces: false,
      config: { detailBudget: 10 },
    });
    expect(created.supermarketId).toBe(NEW_CHAIN);
    expect(created.enabled).toBe(false);
  });

  it('does not take a failed read for "this chain has no source"', async () => {
    const { gateway, harvest } = setup();
    jest
      .spyOn(harvest, 'readSource')
      .mockRejectedValue(
        new GatewayError({ code: '', status: 0, correlationId: '' })
      );
    const upsert = jest.spyOn(harvest, 'upsertSource');

    await expect(
      gateway.create({ supermarketId: NEW_CHAIN, adapterKey: 'manual' })
    ).rejects.toMatchObject({ status: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  /** The form sends what changed, and the route takes the whole source. */
  it('changes a source by sending the whole of it, with the change over it', async () => {
    const { gateway, harvest } = setup();
    const before = await harvest.readSource(MERCADONA);
    const upsert = jest.spyOn(harvest, 'upsertSource');

    const saved = await gateway.update(MERCADONA, { workers: 9 });

    expect(upsert).toHaveBeenCalledWith(MERCADONA, {
      adapterKey: before.adapterKey,
      workers: 9,
      maxRequestsPerSecond: before.maxRequestsPerSecond,
      autoImportPlaces: before.autoImportPlaces,
      config: before.config,
    });
    expect(saved.workers).toBe(9);
  });

  it('saves "places are added with no review" and leaves fetching alone', async () => {
    const { gateway, harvest } = setup();
    await harvest.setSourceEnabled(MERCADONA, true);
    const upsert = jest.spyOn(harvest, 'upsertSource');

    const saved = await gateway.update(MERCADONA, {
      autoImportPlaces: true,
      enabled: false,
    });

    expect(upsert.mock.calls[0][1]).not.toHaveProperty('enabled');
    expect(saved.autoImportPlaces).toBe(true);
    expect(saved.enabled).toBe(true);
  });

  /**
   * A row written before the adapter went cannot be sent back as it is: the
   * server refuses the key. It is said under the adapter, and nothing is
   * written until another is chosen.
   */
  it('refuses to resend an OpenStreetMap adapter, and takes another', async () => {
    const { gateway, harvest } = setup();
    const old: View = {
      ...(await harvest.readSource(MERCADONA)),
      adapterKey: 'osm-places',
    };
    jest.spyOn(harvest, 'readSource').mockResolvedValue(old);
    const upsert = jest.spyOn(harvest, 'upsertSource');

    await expect(
      gateway.update(MERCADONA, { workers: 2 })
    ).rejects.toMatchObject({
      fieldErrors: { adapterKey: ['harvest.sources.adapterGone'] },
    });
    expect(upsert).not.toHaveBeenCalled();

    await gateway.update(MERCADONA, { adapterKey: 'manual' });
    expect(upsert.mock.calls[0][1].adapterKey).toBe('manual');
  });

  it('deletes the source of the chain', async () => {
    const { gateway, harvest } = setup();
    const remove = jest.spyOn(harvest, 'deleteSource');

    await gateway.remove(MERCADONA);

    expect(remove).toHaveBeenCalledWith(MERCADONA);
    await expect(harvest.readSource(MERCADONA)).rejects.toMatchObject({
      status: 404,
    });
  });

  /** The backend refuses while a run of the chain is in flight. */
  it('passes a refused delete on as it is', async () => {
    const { gateway, harvest } = setup();
    jest
      .spyOn(harvest, 'deleteSource')
      .mockRejectedValue(
        new GatewayError({ code: 'conflict', status: 409, correlationId: '' })
      );

    await expect(gateway.remove(MERCADONA)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  describe('when the read of the list fails', () => {
    const silent = new GatewayError({ code: '', status: 0, correlationId: '' });

    it('says so for the first page, until it is asked to read again', async () => {
      const { gateway, harvest } = setup();
      jest.spyOn(harvest, 'listSources').mockRejectedValue(silent);

      await expect(gateway.list({})).rejects.toBe(silent);
      expect(gateway.listFailed()).toBe(true);

      gateway.retryList();
      expect(gateway.listFailed()).toBe(false);
    });

    /** The rows that were read stay, and the list says the rest failed. */
    it('does not say so for a further page', async () => {
      const { gateway, harvest } = setup();
      jest.spyOn(harvest, 'listSources').mockRejectedValue(silent);

      await expect(gateway.list({ cursor: 'next' })).rejects.toBe(silent);
      expect(gateway.listFailed()).toBe(false);
    });
  });
});
