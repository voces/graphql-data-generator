import { OperationMock, Patch, SimpleOperationMock } from "./types.ts";

export type EmptyObject = Record<string, never>;

// Very similar to object patch, except without array helpers
type DefaultObjectTransformSwitch<T, U> = T extends (infer G)[]
  ? DefaultObjectTransformSwitch<G, U>[]
  : DefaultObjectTransform<T, U>;
type DefaultObjectTransform<T, U = T> = {
  [K in keyof T]?: T[K] extends object ?
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
> =
  & ((
    ...patches: (
      | Patch<SimpleOperationMock<Data, Variables>>
      | ((
        prev: SimpleOperationMock<Data, Variables>,
      ) => Patch<SimpleOperationMock<Data, Variables>>)
    )[]
  ) => OperationBuilderWithMock<Data, Variables, Transforms>)
  & {
    variables: (
      variables:
        | Patch<Variables>
        | ((data: Data, variables: Variables) => Patch<Variables>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    data: (
      data:
        | Patch<Data>
        | ((variables: Variables, data: Data) => Patch<Data>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    patch: (
      patch: Patch<{ data: Data; variables: Variables }>,
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    /** Creates a clone of the mock. The clone is  */
    clone: (
      patch?: Patch<{ data: Data; variables: Variables }>,
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
  }
  & {
    [Transform in keyof Transforms]: Transforms[Transform] extends // deno-lint-ignore no-explicit-any
    (...args: any[]) => unknown ? (
        ...params: Shift<Parameters<Transforms[Transform]>>
      ) => OperationBuilderWithMock<Data, Variables, Transforms>
      : () => OperationBuilderWithMock<Data, Variables, Transforms>;
  }
  & OperationBuilderWithMock<Data, Variables, Transforms>[]
  // Why can't this use Collection?
  & {
    readonly length: number;
    readonly find: <
      U extends OperationBuilderWithMock<Data, Variables, Transforms>,
    >(
      fn: (v: OperationBuilderWithMock<Data, Variables, Transforms>) => v is U,
    ) => U | undefined;
    readonly last:
      | (
        & OperationBuilderWithMock<Data, Variables, Transforms>
        & ObjectBuilder<
          OperationBuilderWithMock<Data, Variables, Transforms>,
          EmptyObject
        >
      )
      | undefined;
    /** `field` defaults to `id` */
    readonly findBy: (
      id: unknown,
      field?: keyof OperationBuilderWithMock<Data, Variables, Transforms>,
    ) =>
      | (
        & OperationBuilderWithMock<Data, Variables, Transforms>
        & ObjectBuilder<
          OperationBuilderWithMock<Data, Variables, Transforms>,
          EmptyObject
        >
      )
      | undefined;
    readonly filter: <
      U extends OperationBuilderWithMock<Data, Variables, Transforms>,
    >(
      fn: (v: OperationBuilderWithMock<Data, Variables, Transforms>) => v is U,
    ) => U[];
    readonly all: OperationBuilderWithMock<Data, Variables, Transforms>[];
  };
// & Collection<OperationBuilderWithMock<Data, Variables, Transforms>>;

type OperationBuilderWithMock<
  Data extends Record<string, unknown>,
  Variables,
  Transforms,
> =
  & OperationBuilder<Data, Variables, Transforms>
  & OperationMock<Data, Variables>;

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
    K extends keyof Transforms ? Transforms[K] : EmptyObject
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

type MapOperationsToBuilders<T, Transforms> = {
  [K in keyof T]: OperationBuilder<
    T[K] extends { data: infer U }
      ? U extends Record<string, unknown> ? U : Record<string, unknown>
      : Record<string, unknown>,
    T[K] extends { variables: infer U } ? U : unknown,
    K extends keyof Transforms ? Transforms[K] : EmptyObject
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
> =
  & MapObjectsToBuilders<Types & Inputs, Transforms>
  & MapOperationsToBuilders<
    ResolveConflicts<Queries, Mutations, Subscriptions, Types, Inputs>,
    Transforms
  >;
