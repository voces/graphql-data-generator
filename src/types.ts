export type EmptyObject = Omit<{ foo: "string" }, "foo">;
// export type EmptyObject = Record<string, never>;

type ArrayPatch<T, Root = never> =
  | Patch<T>[]
  | ({ [K in number]?: Patch<T, Root> } & {
    length?: number;
    /** Append a value to the array. */
    next?: Patch<T, Root>;
    /** Patch the last value in the array. */
    last?: Patch<T, Root>;
  });
export type ObjectPatch<T, Root = never> = {
  [K in keyof T]?:
    | (T[K] extends object | null | undefined ? Patch<T[K], Root> : T[K])
    // | (Root extends never
    //   ? () => T[K] extends object | null | undefined ? Patch<T[K], Root> : T[K]
    //   : (
    //     previous: Root,
    //   ) => T[K] extends object | null | undefined ? Patch<T[K], Root> : T[K]);
    | ((
      // This is resolving as never instead of T...
      previous: Root extends never ? T : Root,
    ) => T[K] extends object | null | undefined ? Patch<T[K], Root>
      : T[K] | undefined | null);
};
export type Patch<T, Root = never> = T extends (infer U)[] ? ArrayPatch<U, Root>
  : ObjectPatch<T, Root>;

// Very similar to object patch, except without array helpers
type DefaultObjectTransformSwitch<T, U> = T extends (infer G)[]
  ? DefaultObjectTransformSwitch<G, U>[]
  : DefaultObjectTransform<T, U>;
type DefaultObjectTransform<T, U = T> = {
  [K in keyof T]?: T[K] extends object //| null | undefined ?
    ?
      | DefaultObjectTransformSwitch<T[K], U>
      | ((host: DeepPartial<U>) => DefaultObjectTransformSwitch<T[K], U>)
    : T[K] | ((host: DeepPartial<U>) => T[K]);
};

type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[]
  : {
    [K in keyof T]?: T[K] extends object | null | undefined ? DeepPartial<T[K]>
      : T[K];
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
  Data = unknown,
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
  Data = unknown,
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

type OperationBuilderWithMock<Data, Variables, Transforms> =
  & OperationBuilder<Data, Variables, Transforms>
  & OperationMock<Data, Variables>;

export type ObjectTransforms<T, Transforms> =
  & {
    [Transform in keyof Transforms]: Transforms[Transform] extends // deno-lint-ignore no-explicit-any
    (...args: any[]) => any ? (
        ...args: Shift<Parameters<Transforms[Transform]>>
      ) => T & ObjectTransforms<T, Transforms>
      : () => T & ObjectTransforms<T, Transforms>;
  }
  & {
    patch: (
      patch: ObjectPatch<T, T> | ((prev: T) => ObjectPatch<T, T>),
    ) => T & ObjectTransforms<T, Transforms>;
    // clone: (patch: ObjectPatch<T, T>) => T & ObjectTransforms<T, Transforms>;
  };

export type ObjectBuilder<T, Transforms> =
  & ((data?: ObjectPatch<T, T>) => T & ObjectBuilder<T, Transforms>)
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
      object: DeepPartial<Objects[Object]>,
      // deno-lint-ignore no-explicit-any
      ...args: any[]
    ) => ObjectPatch<Objects[Object]>)
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
    T[K] extends { data: infer U } ? U : unknown,
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
  // Should the Root of these be partial or just data and variables?
  data?: T extends { data: infer U } ? ObjectPatch<U, DeepPartial<T>> : never;
  variables?: T extends { variables: infer U } ? ObjectPatch<U, DeepPartial<T>>
    : never;
};

type OperationTransform<T> = (
  b: {
    data: T extends { data: infer U } ? U : never;
    variables: T extends { variables: infer U } ? U : never;
  },
  // deno-lint-ignore no-explicit-any
  ...args: any[]
) => ObjectPatch<T>;

type InferOperationTransforms<T> =
  | DefaultOperationTransform<T>
  | OperationTransform<T>;

export type InferTransforms<Queries, Mutations, Subscriptions, Types, Inputs> =
  & {
    [
      O in keyof ResolveConflicts<
        Queries,
        Mutations,
        Subscriptions,
        Types,
        Inputs
      >
    ]?: {
      [T in string]: InferOperationTransforms<
        ResolveConflicts<
          Queries,
          Mutations,
          Subscriptions,
          Types,
          Inputs
        >[O]
      >;
    };
  }
  & {
    [O in keyof (Types & Inputs)]?: {
      [T in string]:
        | DefaultObjectTransform<(Types & Inputs)[O]>
        | ((
          obj: (Types & Inputs)[O],
          // deno-lint-ignore no-explicit-any
          ...args: any[]
        ) => ObjectPatch<(Types & Inputs)[O]>);
    };
  };

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
