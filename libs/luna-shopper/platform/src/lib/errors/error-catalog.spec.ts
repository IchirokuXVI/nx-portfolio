import { resolveErrorMessage } from './error-catalog';
import { ERROR_CODES } from './error-codes';

describe('resolveErrorMessage', () => {
  it('returns the message in the requested locale', () => {
    expect(resolveErrorMessage(ERROR_CODES.NOT_FOUND, 'es')).toBe(
      'No se encontró el recurso solicitado.'
    );
    expect(resolveErrorMessage(ERROR_CODES.NOT_FOUND, 'en')).toBe(
      'The requested resource was not found.'
    );
  });

  it('defaults to English when no locale is given', () => {
    expect(resolveErrorMessage(ERROR_CODES.FORBIDDEN)).toBe(
      'You do not have permission to do that.'
    );
  });

  it('interpolates message arguments', () => {
    expect(
      resolveErrorMessage(ERROR_CODES.CONFLICT, 'en', { name: 'zone' })
    ).toContain('conflicts');
  });
});

describe('the allowance sentences (plan 0234, section 8.1)', () => {
  it('picks the variant the assistant names and fills in the time', () => {
    expect(
      resolveErrorMessage(ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED, 'en', {
        variant: 'user.day',
        time: '00:00',
      })
    ).toBe("You have used today's assistant allowance. It is back at 00:00.");
    expect(
      resolveErrorMessage(ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED, 'es', {
        variant: 'deployment.month',
        time: '1 de noviembre',
      })
    ).toBe(
      'El asistente está descansando. Vuelve a estar disponible el 1 de noviembre.'
    );
  });

  it('never names money for the deployment', () => {
    for (const locale of ['en', 'es'] as const) {
      for (const variant of ['deployment.day', 'deployment.month']) {
        const sentence = resolveErrorMessage(
          ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED,
          locale,
          { variant, time: 'x' }
        );
        expect(sentence).not.toMatch(/budget|money|cost|presupuesto|dinero/i);
      }
    }
  });

  it('falls back to the code sentence for an unknown variant', () => {
    expect(
      resolveErrorMessage(ERROR_CODES.ASSISTANT_ALLOWANCE_REACHED, 'en', {
        variant: 'nonsense',
      })
    ).toBe('The assistant is not available for now. It will be back later.');
  });
});
