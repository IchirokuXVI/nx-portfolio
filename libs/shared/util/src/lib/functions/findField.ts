import { RecursivePaths } from '../types/recursive-paths';

/**
 * Loops the fields specified recursively searching for the last field to return its value.
 * If one of the fields is an array it will iterate over it and add all found values in the array.
 * @param obj Object to search the field in
 * @param fields Fields to search in order
 * @returns Array with the values of the last specified field or undefined if it doesn't exist
 */
export function findField<T = {}>(obj: T, fields: RecursivePaths<T>): any {
  if (!fields) return obj;

  // If the object is an array it will iterate over it and add all found values in the array.
  if (Array.isArray(obj)) {
    const acc = [];

    for (const item of obj) {
      // @ts-ignore Prevents performance issues with the type resolution because of deep recursion
      const foundField = findField(item, fields);

      if (!Array.isArray(foundField)) acc.push(foundField);
      else acc.push(...foundField);
    }

    return acc;
  } else {
    const splittedFields = fields.split('.');
    const firstField = splittedFields[0] as keyof T;

    // If it's a single level return the object's value directly
    if (splittedFields.length === 1) return obj?.[firstField];

    // Array to store the values returned recursively
    let lastFieldValues = [];

    // Converts the object to an array if it's not (so it can be iterated with a for)
    let items = Array.isArray(obj[firstField])
      ? obj[firstField]
      : [obj[firstField]];

    // If it's an array it will iterate over it and add all found values in the array.
    for (const item of items) {
      // Calls recursively and removes the first field with each call
      // @ts-ignore Prevents performance issues with the type resolution because of deep recursion
      let next = findField(item, splittedFields.slice(1));

      lastFieldValues.push(next);
    }

    return lastFieldValues;
  }
}
