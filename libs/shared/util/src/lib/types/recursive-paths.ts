type StopTypes = number | string | boolean | symbol | bigint | Date;

type ExcludedTypes = (...args: any[]) => any;

type Dot<T extends string, U extends string> = '' extends U ? T : `${T}.${U}`;

export type RecursivePaths<T> = T extends StopTypes
    ? ''
    : T extends readonly unknown[]
    ? RecursivePaths<T[number]>
    : {
        [K in keyof T & string]: T[K] extends StopTypes
        ? K
        : T[K] extends ExcludedTypes
        ? never
        : K | Dot<K, RecursivePaths<T[K]>>;
    }[keyof T & string];
