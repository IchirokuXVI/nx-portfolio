import {
  hasHouseNumber,
  isCertainAddress,
  NO_NUMBER,
  streetKey,
} from './street-key';

/** Plan 0265, section 1: every row of the table that a real address used. */
describe('streetKey, the abbreviation table', () => {
  it.each([
    ['Av. Manolete 3', 'Avenida Manolete 3'],
    ['AV MANOLETE 3', 'Avenida Manolete 3'],
    ['Avda. Cervantes, 8', 'Avenida Cervantes 8'],
    ['Avd. Cervantes 8', 'Avenida Cervantes 8'],
    ['C/ Realejo, 1', 'Calle Realejo 1'],
    ['C/Realejo 1', 'Calle Realejo 1'],
    ['Cl. Santa Rosa 12', 'Calle Santa Rosa 12'],
    ['CL SANTA ROSA, 12', 'Calle Santa Rosa 12'],
    ['Cll. Santa Rosa 12', 'Calle Santa Rosa 12'],
    ['Pza. Tendillas 1', 'Plaza Tendillas 1'],
    ['Pl. Tendillas 1', 'Plaza Tendillas 1'],
    ['Plza. Tendillas 1', 'Plaza Tendillas 1'],
    ['Ctra. de Trassierra 19', 'Carretera de Trassierra 19'],
    ['Urb. Montealto 25', 'Urbanización Montealto 25'],
    ['Calle Hispania Nº 4', 'Calle Hispania 4'],
    ['Avenida de la Ria, Nº6', 'Avenida de la Ria 6'],
    ['Calle Hispania núm. 4', 'Calle Hispania 4'],
    ['Calle Hispania no 4', 'Calle Hispania 4'],
  ])('reads %s as %s', (written, spelled) => {
    expect(streetKey(written)).toBe(streetKey(spelled));
  });

  it('spells the street word out and drops the small words', () => {
    expect(streetKey('Avda. de la Constitución, 12')).toBe(
      'avenida constitucion 12'
    );
  });
});

describe('streetKey, the rest of an address', () => {
  it('meets Avda. de la Constitución, 12 and Avenida Constitucion 12', () => {
    expect(streetKey('Avda. de la Constitución, 12')).toBe(
      streetKey('Avenida Constitucion 12')
    );
  });

  it('cuts what follows the number: C/ Mayor 5 local 3 is Calle Mayor 5', () => {
    expect(streetKey('C/ Mayor 5 local 3')).toBe(streetKey('Calle Mayor 5'));
    expect(streetKey('Calle Mayor 5, bajo')).toBe('calle mayor 5');
    expect(streetKey('Calle Mayor 5 esquina Calle Real')).toBe('calle mayor 5');
  });

  it('keeps two numbers on one street apart', () => {
    expect(streetKey('Calle Mayor 5')).not.toBe(streetKey('Calle Mayor 7'));
    expect(streetKey('Avda. de Cádiz, 68')).not.toBe(
      streetKey('Avenida de Cádiz 70')
    );
  });

  it('reads s/n as a number of its own', () => {
    expect(streetKey('Calle Madrid, s/n')).toBe(`calle madrid ${NO_NUMBER}`);
    expect(streetKey('Calle Madrid S/N local 2')).toBe(
      `calle madrid ${NO_NUMBER}`
    );
    expect(streetKey('Calle Madrid s/n')).not.toBe(streetKey('Calle Madrid 5'));
  });

  it('reads a one letter word as a street word only where the table says', () => {
    // `c` is `calle` as the first word only, `n` is dropped only before a number.
    expect(streetKey('Plaza de la C Mayor')).toBe('plaza c mayor');
    expect(streetKey('Calle N Mayor 3')).toBe('calle n mayor 3');
  });

  it('leaves a word it does not know as it is', () => {
    expect(streetKey('Paseo del Romeral, 15')).toBe('paseo romeral 15');
    expect(streetKey('RD DEL MARRUBIAL, 27')).toBe('rd marrubial 27');
  });

  it('answers an empty key for an empty address', () => {
    expect(streetKey('')).toBe('');
    expect(streetKey(' , ')).toBe('');
  });
});

describe('hasHouseNumber', () => {
  it('is true for a number and false for s/n or none', () => {
    expect(hasHouseNumber(streetKey('Calle Mayor 5'))).toBe(true);
    expect(hasHouseNumber(streetKey('Carretera de Trassierra, 19B'))).toBe(
      true
    );
    expect(hasHouseNumber(streetKey('Calle Mayor s/n'))).toBe(false);
    expect(hasHouseNumber(streetKey('Avenida de Libia'))).toBe(false);
  });
});

/** Plan 0265, D5: the one rule that decides a key can be trusted. */
describe('isCertainAddress', () => {
  it.each([
    'Calle Mayor 5',
    'Avda. de Cádiz, 68',
    'Calle Mayor 7B',
    'Calle Mayor 7 B',
    'Calle Mayor 5, bajo',
    'Avenida de Cádiz, s/n',
    'Avenida de Cádiz',
    '',
  ])('trusts %s', (address) => {
    expect(isCertainAddress(address)).toBe(true);
  });

  it.each([
    'Avenida 28 de Febrero, 12',
    'Calle 1º de Mayo 3',
    'Ctra. A-431, km 3',
    'Ctra. N-340 km 12',
    'C/ Mayor 5 local 3',
    'Calle Mayor 5, 14001 Córdoba',
    '14001 Córdoba, Calle Mayor 5',
    '5, Calle Mayor',
  ])('does not trust %s', (address) => {
    expect(isCertainAddress(address)).toBe(false);
  });
});
