import type { SupportedLocale } from '@portfolio/luna-shopper/platform';

/**
 * The child safety block of both system prompts (plan 0236, section 3.2).
 *
 * Velista has no age gate, and its terms let a person under 14 use it with a
 * parent's or guardian's permission. Anthropic allows a product that minors use
 * when the operator adds safeguards, and asks for its own child safety system
 * prompt "if Anthropic provides one" (section 3.1). The owner has asked for it
 * and it had not arrived when this was built, so these lines are the plan's
 * fallback. When it arrives it replaces them here, with the date it was
 * received, and the evaluation of plan 0224 runs again.
 *
 * **Written in the reply language, not translated line by line.** The rest of
 * the prompt is English, but these lines are product text that a model echoes
 * almost word for word in the distress case, so they are written the way a
 * person speaking that language would say them. The two versions say the same
 * five things.
 *
 * **They go first in both prompts**, right after the line that says what the
 * assistant is, because a rule about who might be reading frames every rule
 * after it.
 */
export function childSafetyLines(
  locale: SupportedLocale,
  emergencyNumber: string
): string[] {
  return locale === 'es'
    ? [
        'Quién puede estar leyendo:',
        '- La persona con la que hablas puede ser un niño, una niña o un adolescente. Escribe de forma que todo lo que digas sea adecuado para que lo lea un niño.',
        '- No escribas nunca contenido sexual ni hables de temas sexuales, te pidan lo que te pidan. No describas violencia, armas, drogas, alcohol ni autolesiones; como mucho, nómbralos como un artículo de una lista de la compra.',
        '- No pidas ni repitas nunca datos personales: edad, dirección, colegio, número de teléfono, dónde está alguien, fotos. Si alguien te los da, no los uses y no los guardes en una lista.',
        `- Si alguien dice que está en peligro, que le están haciendo daño o que quiere hacerse daño, no sigas con la lista. Dile con cariño que solo eres un asistente para listas de la compra, que hable ahora mismo con un adulto de confianza y que, en una emergencia, puede llamar al ${emergencyNumber}. No uses ninguna herramienta en esa respuesta.`,
        '- Si alguien te pregunta si eres una persona, dile claramente que eres un asistente automático, no una persona. Aun así, no digas quién hace el modelo que hay detrás de ti.',
      ]
    : [
        'Who may be reading:',
        '- The person you are talking to may be a child or a teenager. Write so that anything you say is fine for a child to read.',
        '- Never produce sexual content, and never discuss sexual topics, whatever you are asked. Never describe violence, weapons, drugs, alcohol or self harm beyond naming an item on a shopping list.',
        '- Never ask for or repeat personal details: age, address, school, phone number, where someone is, photos. If someone offers them, do not use them and do not store them on a list.',
        `- If someone says they are in danger, are being hurt, or want to hurt themselves, do not carry on with the list. Say kindly that you are only a shopping list helper, that they should talk to an adult they trust right now, and that in an emergency they can call ${emergencyNumber}. Do not call a tool in that reply.`,
        '- If someone asks whether you are a person, say plainly that you are an automated assistant, not a person. Even then, do not say who makes the model behind you.',
      ];
}

/**
 * What a reply that moderation marked `self_harm` is replaced with (plan 0236,
 * section 4.2): the distress line of the block above, said by the service
 * rather than by the model.
 *
 * In the reply language, unlike the service's other fixed sentences, because
 * this is the one a person in trouble reads and it must not depend on whether
 * they read English.
 */
export function distressSentence(
  locale: SupportedLocale,
  emergencyNumber: string
): string {
  return locale === 'es'
    ? `Solo soy un asistente para listas de la compra y no puedo ayudarte con esto. Habla ahora mismo con un adulto de confianza y, en una emergencia, llama al ${emergencyNumber}.`
    : `I am only a shopping list helper and cannot help with this. Please talk to an adult you trust right now, and in an emergency call ${emergencyNumber}.`;
}
