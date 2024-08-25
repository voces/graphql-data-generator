type ArrayPatch<T> =
  | Patch<T>[]
  | ({ [K in number]?: Patch<T> } & {
    length?: number;
    /** Append a value to the array. */
    next?: Patch<T>;
    /** Patch the last value in the array. */
    last?: Patch<T>;
  });
export type ObjectPatch<T> = {
  [K in keyof T]?:
    | (T[K] extends object | null | undefined ? Patch<T[K]> : T[K])
    | ((
      previous: T,
    ) =>
      | (T[K] extends object | null | undefined ? Patch<T[K]> : T[K])
      | undefined
      | null);
};
export type Patch<T> = T extends (infer U)[] ? ArrayPatch<U>
  : ObjectPatch<T>;
