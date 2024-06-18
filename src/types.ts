export type EmptyObject = Omit<{ foo: "string" }, "foo">;
// export type EmptyObject = Record<string, never>;

type ArrayPatch<T, F extends T, Ancestors extends unknown[]> =
  | Patch<T, F, Ancestors>[]
  | ({ [K in number]?: Patch<T, F, Ancestors> } & {
    length?: number;
    /** Append a value to the array. */
    next?: Patch<T, F, Ancestors>;
    /** Patch the last value in the array. */
    last?: Patch<T, F, Ancestors>;
  });
type ObjectPatch<T, F extends T = T, Ancestors extends unknown[] = []> = {
  [K in keyof T]?:
    | (T[K] extends object | null | undefined
      ? Patch<T[K], F[K], [F, ...Ancestors]>
      : T[K])
    | ((
      previous: F,
      ...ancestors: Ancestors
    ) => T[K] extends object | null | undefined
      ? Patch<T[K], F[K], [F, ...Ancestors]>
      : T[K] | undefined | null);
};
export type Patch<T, F extends T = T, Ancestors extends unknown[] = []> =
  T extends (infer U)[]
    ? F extends (infer V)[] ? V extends U ? ArrayPatch<U, V, Ancestors> : never
    : never
    : ObjectPatch<T, F, Ancestors>;

// Very similar to object patch, except without array helpers
type DefaultObjectTransformSwitch<T, U> = T extends (infer G)[]
  ? DefaultObjectTransformSwitch<G, U>[]
  : DefaultObjectTransform<T, U>;
type DefaultObjectTransform<T, U = T> = {
  [K in keyof T]?: T[K] extends object //| null | undefined ?
    ?
      | DefaultObjectTransformSwitch<T[K], U>
      | ((host: U) => DefaultObjectTransformSwitch<T[K], U>)
    : T[K] | ((host: U) => T[K]);
};

export type Options<
  Data = unknown,
  Variables = Record<string, unknown> | never,
> = {
  data?: ObjectPatch<Data>;
  variables?: ObjectPatch<Variables>;
  refetch?: boolean;
  optional?: boolean;
};

export type OperationMock<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Variables = Record<string, unknown> | never,
> = {
  request: { query: string; variables?: Variables };
  result: { data?: Data; errors?: unknown[] };
};

type Shift<T extends unknown[]> = T extends [infer _First, ...infer Rest] ? Rest
  : never;

type Collection<T, Transforms> = {
  readonly length: number;
  readonly find: <U extends T>(fn: (v: T) => v is U) => U | undefined;
  readonly last: (T & ObjectBuilder<T, Transforms>) | undefined;
  /** `field` defaults to `id` */
  readonly findBy: (
    id: unknown,
    field?: keyof T,
  ) => (T & ObjectBuilder<T, Transforms>) | undefined;
  readonly filter: <U extends T>(fn: (v: T) => v is U) => U[];
  readonly all: T[];
};

export type OperationBuilder<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Variables = unknown,
  Transforms = unknown,
> =
  & ((
    options?: Options<Data, Variables>,
  ) => OperationBuilderWithMock<Data, Variables, Transforms>)
  & {
    variables: (
      variables:
        | ObjectPatch<Variables>
        | ((data: Data, variables: Variables) => ObjectPatch<Variables>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    data: (
      data:
        | ObjectPatch<Data>
        | ((variables: Variables, data: Data) => ObjectPatch<Data>),
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    patch: (
      patch: ObjectPatch<{ data: Data; variables: Variables }>,
    ) => OperationBuilderWithMock<Data, Variables, Transforms>;
    /** Creates a clone of the mock. The clone is  */
    clone: (
      patch?: ObjectPatch<{ data: Data; variables: Variables }>,
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
      patch: ObjectPatch<T> | ((prev: T) => ObjectPatch<T>),
    ) => T & ObjectTransforms<T, Transforms>;
    // clone: (patch: ObjectPatch<T, T>) => T & ObjectTransforms<T, Transforms>;
  };

export type ObjectBuilder<T, Transforms> =
  & ((data?: ObjectPatch<T>) => T & ObjectBuilder<T, Transforms>)
  & ObjectTransforms<T, Transforms>
  & Collection<T, Transforms>;

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
    ) => ObjectPatch<Objects[Object]>)
  >;
};

type InnerMapOperationsToTransforms<Operations, Types> = {
  [Operation in keyof Operations]?: Record<
    string,
    InferOperationTransforms<Operations[Operation], Types>
  >;
};

export type MapOperationsToTransforms<
  Queries,
  Mutations,
  Subscriptions,
  Types,
  Inputs,
> = InnerMapOperationsToTransforms<
  ResolveConflicts<Queries, Mutations, Subscriptions, Types, Inputs>,
  Types
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

type FullSchemaType<T, Types> = "__typename" extends keyof T
  ? T["__typename"] extends keyof Types ? Types[T["__typename"]] : T
  : T extends object ? { [K in keyof T]: FullSchemaType<T[K], Types> }
  : T;

type DefaultOperationTransform<T, Types> = {
  data?: T extends { data: infer D } ? ObjectPatch<
      D,
      FullSchemaType<D, Types> extends D ? FullSchemaType<D, Types> : D,
      T extends { variables: infer V } ? [V]
        : []
    >
    : never;
  variables?: T extends { variables: infer V }
    ? ObjectPatch<V, V, T extends { data: infer D } ? [D] : []>
    : never;
};

type OperationTransform<T, Types> = (
  b: {
    data: T extends { data: infer U } ? U : never;
    variables: T extends { variables: infer U } ? U : never;
  },
  // deno-lint-ignore no-explicit-any
  ...args: any[]
) => ObjectPatch<
  T,
  FullSchemaType<T, Types> extends T ? FullSchemaType<T, Types> : T
>;

type InferOperationTransforms<T, Types> =
  | DefaultOperationTransform<T, Types>
  | OperationTransform<T, Types>;

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
