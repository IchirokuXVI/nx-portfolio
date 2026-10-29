import {
  MembershipStatus,
  type ListView,
  type MyZoneView,
} from '@portfolio/luna-shopper/contracts';
import type { SupportedLocale } from '@portfolio/luna-shopper/platform';
import { childSafetyLines } from './child-safety';
import type { GatewayApiClient } from './gateway-api.client';
import { buildSystemPrompt } from './prompt';
import { TurnContextFactory, type TurnContext } from './turn-context';

/**
 * The child safety block and the disclosure in both prompts (plan 0236,
 * section 3).
 */

const API = {
  listZones: async (): Promise<MyZoneView[]> => [
    {
      id: 'zone-home',
      name: 'Casa',
      myStatus: MembershipStatus.APPROVED,
    } as MyZoneView,
  ],
  listLists: async (): Promise<ListView[]> => [
    { id: 'list-flat', zoneId: 'zone-home', name: 'Piso' } as ListView,
  ],
  listLines: async () => [],
} as unknown as GatewayApiClient;

const CALLER = { authorization: 'Bearer token', locale: 'es' as const };

async function contexts(): Promise<Record<'open' | 'scoped', TurnContext>> {
  const factory = new TurnContextFactory(API);
  return {
    open: await factory.open(CALLER),
    scoped: await factory.openScoped(CALLER, {
      zoneId: 'zone-home',
      listId: 'list-flat',
    }),
  };
}

function promptFor(
  context: TurnContext,
  locale: SupportedLocale,
  emergencyNumber = '112'
): string {
  return buildSystemPrompt({ context, locale, emergencyNumber });
}

describe('the child safety block (plan 0236, section 3.2)', () => {
  it('opens both prompts, in the reply language, before any rule', async () => {
    const both = await contexts();
    for (const variant of ['open', 'scoped'] as const) {
      for (const locale of ['en', 'es'] as const) {
        const prompt = promptFor(both[variant], locale);
        const lines = prompt.split('\n');
        const block = childSafetyLines(locale, '112');

        // Right after the line that says what the assistant is.
        expect(lines.slice(2, 2 + block.length)).toEqual(block);
        expect(prompt.indexOf(block[0])).toBeLessThan(
          prompt.indexOf(variant === 'open' ? 'What you are for:' : 'Rules:')
        );
      }
    }
  });

  it('is written in Spanish for a Spanish reply and in English otherwise', () => {
    expect(childSafetyLines('es', '112')[0]).toBe('Quién puede estar leyendo:');
    expect(childSafetyLines('en', '112')[0]).toBe('Who may be reading:');
    for (const locale of ['en', 'es'] as const) {
      expect(childSafetyLines(locale, '112')).toHaveLength(6);
    }
  });

  it('interpolates the emergency number in both languages', async () => {
    const { open } = await contexts();
    for (const locale of ['en', 'es'] as const) {
      const prompt = promptFor(open, locale, '911');
      expect(prompt).toContain('911');
      expect(prompt).not.toContain('112');
    }
  });

  it('carries the disclosure that the assistant is not a person', async () => {
    const both = await contexts();
    expect(promptFor(both.open, 'en')).toContain(
      'say plainly that you are an automated assistant, not a person'
    );
    expect(promptFor(both.scoped, 'es')).toContain(
      'eres un asistente automático, no una persona'
    );
  });

  it('says the assistant is automated when asked what it is (section 3.4)', async () => {
    const { open } = await contexts();
    expect(promptFor(open, 'en')).toContain(
      'Asked what you are, say that you are an automated assistant'
    );
  });
});
