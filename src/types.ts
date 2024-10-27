import type { GraphQLError } from "npm:graphql";

export type ContravariantEmpty = Record<string, never>;
export type CovariantEmpty = object;

type ArrayPatch<T> =
  | Patch<T>[]
  | ({ [K in number]?: Patch<T> } & {
    length?: number;
    /** Append a value to the array. */
    next?: Patch<T>;
    /** Patch the last value in the array. */
    last?: Patch<T>;
  });
type ObjectPatch<T> = {
  [K in keyof T]?:
    | (T[K] extends object | null | undefined ? Patch<T[K]> : T[K])
    | ((previous: T) =>
      | (T[K] extends object | null | undefined ? Patch<T[K]> : T[K])
      | undefined
      | null);
};
export type Patch<T> = T extends (infer U)[] ? ArrayPatch<U>
  : ObjectPatch<T>;

export type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[]
  : T extends object ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

export type OperationMock<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Variables = Record<string, unknown> | never,
> = {
  request: { query: string; variables?: Variables };
  result: { data?: Data; errors?: GraphQLError[] };
  error?: Error;
};

export type SimpleOperationMock<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Variables = Record<string, unknown> | never,
> = {
  data: Data;
  variables?: Variables;
  error?: Error;
  errors?: GraphQLError[];
};
