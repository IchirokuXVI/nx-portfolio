import { findField } from "./findField";

// Named checkers defined once and reusable
const checkers: Record<
  string,
  {
    condition: (a: any, b: any) => boolean;
    compare: (a: any, b: any) => number;
  }
> = {
  comparableObjects: {
    condition: (a, b) =>
      typeof a === typeof b &&
      a !== null &&
      typeof a === "object" &&
      (typeof (a as any).compare === "function" ||
        typeof (a as any).compareTo === "function"),
    compare: (a, b) =>
      typeof (a as any).compare === "function"
        ? (a as any).compare(b)
        : (a as any).compareTo(b),
  },
  numbers: {
    condition: (a, b) => typeof a === "number" && typeof b === "number",
    compare: (a, b) => a - b,
  },
  strings: {
    condition: (a, b) => typeof a === "string" && typeof b === "string",
    compare: (a, b) => a.localeCompare(b),
  },
  dates: {
    condition: (a, b) => a instanceof Date && b instanceof Date,
    compare: (a, b) => a.getTime() - b.getTime(),
  },
  booleans: {
    condition: (a, b) => typeof a === "boolean" && typeof b === "boolean",
    compare: (a, b) => Number(a) - Number(b),
  },
  fallback: {
    condition: () => true,
    compare: (a, b) => String(a).localeCompare(String(b)),
  },
};

// The order in which checkers are applied
const checkerOrder = [
  "comparableObjects",
  "numbers",
  "strings",
  "dates",
  "booleans",
  "fallback",
];

/**
 * Sorts an array of objects based on the specified fields and options. Used with Array.prototype.sort.
 * @param fields Fields to sort by, separated by space. Prefix with - for descending and + or nothing for ascending
 * @param options Options for sorting behavior
 * @returns A comparison function for sorting
 */
export function multiSort<T>(fields: string) {
  return (a: T, b: T): number => {
    let result = 0;

    for (let field of fields.split(" ")) {
      let direction = 1;
      if (field.startsWith("-")) {
        direction = -1;
        field = field.slice(1);
      } else if (field.startsWith("+")) {
        field = field.slice(1);
      }

      const path = field.split(".");
      // findField<T> makes the compiler complain about being too deep and possibly infinite
      const valA = findField<any>(a, path);
      const valB = findField<any>(b, path);

      if (valA === valB) continue;

      for (const key of checkerOrder) {
        const checker = checkers[key];
        if (checker.condition(valA, valB)) {
          const cmp = checker.compare(valA, valB);
          if (cmp !== 0) {
            result = cmp * direction;
            break;
          }
        }
      }

      if (result !== 0) break;
    }

    return result;
  };
}
