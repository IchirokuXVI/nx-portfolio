export const TeethNumbers = [
  "11", "12", "13", "14", "15", "16", "17", "18",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "31", "32", "33", "34", "35", "36", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48",
  "51", "52", "53", "54", "55",
  "61", "62", "63", "64", "65",
  "71", "72", "73", "74", "75",
  "81", "82", "83", "84", "85"
] as const;

export const TeethNumbersTranslationKey = TeethNumbers.reduce((acc, number) => {
  acc[number] = `odontogram.tooth.${number}`;
  return acc;
}, {} as { [key in typeof TeethNumbers[number]]: string });
