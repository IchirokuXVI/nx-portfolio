import { inject } from '@angular/core';
import {
  defineResource,
  fieldMessage,
  scheduleState,
} from '@portfolio/luna-shopper-admin/models';
import { SchedulePage } from './schedule-page';
import { SchedulesGateway, type Schedule } from './schedules-gateway';

export type { Schedule };

/**
 * A preset that starts by itself at a time of day, on some days of the week
 * (admin plan 0067; backend plan 0206).
 *
 * **Under Setup, beside the chain sources.** A schedule is set up once and
 * then left, which is what Setup holds. The presets panel of the Runs tab
 * draws the cadence of each preset and links here, so a person who looks at
 * presets sees when they run without a trip to Setup.
 *
 * **Its page is the record page with a body of its own** (`editor`). Three of
 * its controls are no field kind: seven day toggles, a time of day, and the
 * box a person ticks to say they know the chain is fetched with nobody
 * watching. `SchedulePage` is `RecordPage`, with the header, the More menu, the
 * questions and the leave guard of every record, and draws those rows itself
 * from the parts of the record page.
 *
 * **Whether a schedule is on is not a field of the form.** It is changed by
 * the two named actions and by nothing else. Turning one on asks the consent
 * of a new schedule in its question, so it is drawn on the record page alone,
 * where that question can name the chain and the page says first what keeps
 * the schedule from running.
 */
export const SCHEDULES = defineResource<Schedule>({
  name: 'schedules',
  // Under the Setup tab of the harvester, where `harvestRoutes` mounts it.
  segment: 'schedules',
  labels: {
    one: 'harvest.schedules.one',
    many: 'harvest.schedules.many',
    noun: 'harvest.schedules.noun',
    create: 'harvest.schedules.add',
  },

  // The preset, which is what the schedule starts. The chain and the days are
  // the line under it.
  title: (row) => row.presetName,

  fields: [
    {
      kind: 'text',
      name: 'presetId',
      label: 'harvest.schedules.field.preset',
      required: true,
      // The preset of a schedule never changes: to point at another, delete
      // the schedule and add one (backend plan 0206, section 4).
      editable: 'create',
    },
    {
      kind: 'text',
      name: 'presetName',
      label: 'harvest.schedules.field.preset',
      editable: false,
    },
    {
      kind: 'reference',
      name: 'supermarketId',
      label: 'harvest.schedules.field.chain',
      resource: 'supermarkets',
      // From the preset, on the server.
      editable: false,
      nameLookup: true,
    },
    {
      kind: 'text',
      name: 'cadence',
      label: 'harvest.schedules.field.cadence',
      editable: false,
    },
    {
      kind: 'date',
      name: 'nextRunAt',
      label: 'harvest.schedules.field.nextRunAt',
      time: true,
      nullable: true,
      editable: false,
    },
    {
      kind: 'text',
      name: 'timeOfDay',
      label: 'harvest.schedules.field.time',
      required: true,
    },
    {
      // The days as one text, "1,3,5", sorted. The page draws seven toggles
      // for it and the gateway sends the numbers.
      kind: 'text',
      name: 'daysOfWeek',
      label: 'harvest.schedules.field.days',
      required: true,
    },
    {
      kind: 'text',
      name: 'timezone',
      label: 'harvest.schedules.field.timezone',
    },
    {
      kind: 'boolean',
      name: 'enabled',
      label: 'harvest.schedules.field.enabled',
      // Changed by the two named actions and by nothing else.
      editable: false,
      setBy: 'harvest.schedules.enabledSetBy',
    },
    {
      // The consent of a new schedule. Never on a row and never kept: the
      // gateway sends `true` for it in the save that the tick belongs to.
      kind: 'boolean',
      name: 'acknowledgedAutomaticFetch',
      label: 'harvest.schedules.field.consent',
      editable: 'create',
    },
  ],

  list: {
    columns: ['presetName', 'supermarketId', 'cadence', 'nextRunAt'],
    // The title is the preset. The chain and when it runs are the card, and
    // the state beside the name says whether it will.
    compact: ['supermarketId', 'cadence'],
    brief: {
      sentence: (row) =>
        fieldMessage('harvest.schedules.brief', {
          chain: row.chainName ?? row.supermarketId,
          when: row.cadence,
        }),
    },
    empty: 'harvest.schedules.empty',
  },

  info: {
    title: 'harvest.schedules.info.title',
    points: [
      'harvest.schedules.info.what',
      'harvest.schedules.info.source',
      'harvest.schedules.info.production',
    ],
  },

  filters: [
    {
      kind: 'reference',
      param: 'supermarketId',
      label: 'harvest.schedules.field.chain',
      resource: 'supermarkets',
    },
  ],

  rowStates: () => (row) => {
    switch (scheduleState(row)) {
      case 'on':
        return [{ label: 'harvest.schedules.state.on', tone: 'good' }];
      case 'blocked':
        return [{ label: 'harvest.schedules.state.blocked', tone: 'waiting' }];
      default:
        return [{ label: 'harvest.schedules.state.off', tone: 'neutral' }];
    }
  },

  actions: {
    create: true,
    edit: true,
    named: () => {
      const schedules = inject(SchedulesGateway);
      return [
        {
          name: 'turn-on',
          label: 'harvest.schedules.action.on',
          available: (row) => !row.enabled,
          // The question names the chain, and only the record page can say
          // it: a question of a list row is handed the title alone.
          recordOnly: true,
          confirm: {
            heading: 'harvest.schedules.confirm.on.heading',
            body: 'harvest.schedules.consent.text',
            confirm: 'harvest.schedules.confirm.on.confirm',
          },
          // The consent is sent here, in the act the question was answered
          // in, and is not kept.
          run: (row) => schedules.setEnabled(row.id, true),
        },
        {
          name: 'turn-off',
          label: 'harvest.schedules.action.off',
          available: (row) => row.enabled,
          // Taken back by turning it on, which asks.
          run: (row) => schedules.setEnabled(row.id, false),
        },
        {
          name: 'delete-schedule',
          label: 'harvest.schedules.action.delete',
          danger: true,
          recordOnly: true,
          after: 'leave',
          confirm: {
            heading: 'harvest.schedules.confirm.delete.heading',
            body: 'harvest.schedules.confirm.delete.body',
            confirm: 'harvest.schedules.confirm.delete.confirm',
          },
          run: (row) => schedules.remove(row.id),
        },
      ];
    },
  },

  // The two sections of section 3 of the plan. `ScheduleView` draws them, with
  // the Record block after them, and reads their titles from here.
  record: {
    sections: [
      {
        title: 'harvest.schedules.section.what',
        fields: ['presetId', 'supermarketId'],
      },
      {
        title: 'harvest.schedules.section.when',
        fields: ['timeOfDay', 'daysOfWeek', 'timezone'],
      },
    ],
  },

  editor: SchedulePage,

  gateway: () => inject(SchedulesGateway),
});
