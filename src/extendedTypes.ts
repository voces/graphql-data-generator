import type {
  ContravariantEmpty,
  OperationMock,
  Patch,
  SimpleOperationMock,
  SimpleOperationPatch,
} from "./types.ts";

// Very similar to object patch, except without array helpers
type DefaultObjectTransformSwitch<T, U> = T extends (infer G)[]
  ? DefaultObjectTransformSwitch<G, U>[]
  : DefaultObjectTransform<T, U>;
type DefaultObjectTransform<T, U = T> = {
  [K in keyof T]?: T[K] extends object | null | undefined ?
      | DefaultObjectTransformSwitch<T[K], U>
      | ((host: U) => DefaultObjectTransformSwitch<T[K], U>)
    : T[K] | ((host: U) => T[K]);
};

export type Shift<T extends unknown[]> = T extends [infer _First, ...infer Rest]
  ? Rest
  : [];

type OperationBuilder<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Variables = unknown,
  Transforms = unknown,
  Extra = ContravariantEmpty,
> =
  & ((
    ...patches: (
      | SimpleOperationPatch<Data, Variables> & Partial<Extra>
      | ((
        prev: SimpleOperationMock<Data, Variables>,
      ) => SimpleOperationPatch<Data, Variables>)
    )[]
  ) => OperationBuilderWithMock<Data, Variables, Transforms, Extra>)
  & {
    variables: (
      variables:
        | Patch<Variables>
        | ((data: Data, variables: Variables) => Patch<Variables>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms, Extra>;
    data: (
      data:
        | Patch<Data>
        | ((variables: Variables, data: Data) => Patch<Data>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms, Extra>;
    patch: (
      patch: SimpleOperationPatch<Data, Variables>,
    ) => OperationBuilderWithMock<Data, Variables, Transforms, Extra>;
  }
  & {
    [Transform in keyof Transforms]: Transforms[Transform] extends // deno-lint-ignore no-explicit-any
    (...args: any[]) => unknown ? (
        ...params: Shift<Parameters<Transforms[Transform]>>
      ) => OperationBuilderWithMock<Data, Variables, Transforms, Extra>
      : () => OperationBuilderWithMock<Data, Variables, Transforms, Extra>;
  };

type OperationBuilderWithMock<
  Data extends Record<string, unknown>,
  Variables,
  Transforms,
  Extra,
> =
  & OperationBuilder<Data, Variables, Transforms>
  & OperationMock<Data, Variables>
  & Partial<Extra>;

type ObjectTransforms<T, Transforms> =
  & {
    [Transform in keyof Transforms]: Transforms[Transform] extends // deno-lint-ignore no-explicit-any
    (...args: any[]) => any ? (
        ...args: Shift<Parameters<Transforms[Transform]>>
      ) => T & ObjectTransforms<T, Transforms>
      : () => T & ObjectTransforms<T, Transforms>;
  }
  & {
    patch: (
      patch: Patch<T> | ((prev: T) => Patch<T>),
    ) => T & ObjectTransforms<T, Transforms>;
    // clone: (patch: Patch<T, T>) => T & ObjectTransforms<T, Transforms>;
  };

type ObjectBuilder<T, Transforms> =
  & ((
    ...patches: (Patch<T> | ((previous: T) => Patch<T>))[]
  ) => T & ObjectTransforms<T, Transforms>)
  & ObjectTransforms<T, Transforms>;
// & Collection<T, Transforms>;

type CapitalizeFirst<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

type PrefixKeys<T, Prefix extends string> = {
  [K in keyof T as `${Prefix}${CapitalizeFirst<string & K>}`]: T[K];
};

type MapObjectsToBuilders<T, Transforms> = {
  [K in keyof T]: ObjectBuilder<
    T[K],
    K extends keyof Transforms ? Transforms[K] : ContravariantEmpty
  >;
};

export type MapObjectsToTransforms<
  Objects extends Record<string, Record<string, unknown>>,
> = {
  [Object in keyof Objects]?: Record<
    string,
    | DefaultObjectTransform<Objects[Object], Objects[Object]>
    | ((
      prev: Objects[Object],
      // deno-lint-ignore no-explicit-any
      ...args: any[]
    ) => Patch<Objects[Object]>)
  >;
};

type InnerMapOperationsToTransforms<Operations> = {
  [Operation in keyof Operations]?: Record<
    string,
    InferOperationTransforms<Operations[Operation]>
  >;
};

export type MapOperationsToTransforms<
  Queries,
  Mutations,
  Subscriptions,
  Types,
  Inputs,
> = InnerMapOperationsToTransforms<
  ResolveConflicts<Queries, Mutations, Subscriptions, Types, Inputs>
>;

type MapOperationsToBuilders<T, Transforms, Extra> = {
  [K in keyof T]: OperationBuilder<
    T[K] extends { data: infer U }
      ? U extends Record<string, unknown> ? U : Record<string, unknown>
      : Record<string, unknown>,
    T[K] extends { variables: infer U } ? U : never,
    K extends keyof Transforms ? Transforms[K] : ContravariantEmpty,
    Extra
  >;
};

type ResolveOperationConflicts<T, Name extends string, A, B, C, D> =
  & Omit<T, keyof A | keyof B | keyof C | keyof D>
  & PrefixKeys<
    Pick<T, keyof T & (keyof A | keyof B | keyof C | keyof D)>,
    Name
  >;

type ResolveConflicts<Queries, Mutations, Subscriptions, Types, Inputs> =
  & ResolveOperationConflicts<
    Queries,
    "queries",
    Mutations,
    Subscriptions,
    Types,
    Inputs
  >
  & ResolveOperationConflicts<
    Mutations,
    "mutations",
    Queries,
    Subscriptions,
    Types,
    Inputs
  >
  & ResolveOperationConflicts<
    Subscriptions,
    "subscriptions",
    Queries,
    Mutations,
    Types,
    Inputs
  >;

type DefaultOperationTransform<T> = {
  data?: T extends { data: infer D } ? Patch<D> : never;
  variables?: T extends { variables: infer V } ? Patch<V>
    : never;
};

type OperationTransform<T> = (
  b: {
    data: T extends { data: infer U } ? U : never;
    variables: T extends { variables: infer U } ? U : never;
  },
  // deno-lint-ignore no-explicit-any
  ...args: any[]
) => Patch<T>;

type InferOperationTransforms<T> =
  | DefaultOperationTransform<T>
  | OperationTransform<T>;

export type Build<
  Queries,
  Mutations,
  Subscriptions,
  Types,
  Inputs,
  Transforms,
  Extra,
> =
  & MapObjectsToBuilders<Types & Inputs, Transforms>
  & MapOperationsToBuilders<
    ResolveConflicts<Queries, Mutations, Subscriptions, Types, Inputs>,
    Transforms,
    Extra
  >;
