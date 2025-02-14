import { readFileSync } from "node:fs";
import { type DocumentNode, Kind, parse } from "npm:graphql";
import { dirname, join } from "node:path";
import { gqlPluckFromCodeStringSync } from "npm:@graphql-tools/graphql-tag-pluck";

import type {
  Build,
  MapObjectsToTransforms,
  MapOperationsToTransforms,
  Shift,
} from "./extendedTypes.ts";
import type {
  ContravariantEmpty,
  CovariantEmpty,
  OperationMock,
  Patch,
  SimpleOperationMock,
} from "./types.ts";
import { operation, proxy, withGetDefaultPatch } from "./proxy.ts";
import { toObject } from "./util.ts";

const files: Record<string, string> = {};
const loadFile = (path: string): string =>
  files[path] || (files[path] = readFileSync(path, "utf-8").replace(
    /#import "(.*)"/,
    (_, fragmentPath) => loadFile(join(dirname(path), fragmentPath)),
  ));

const getOperationContentMap: Record<
  string,
  DocumentNode | Record<string, DocumentNode>
> = {};
const getOperationContent = (
  path: string,
  operationName: string,
): DocumentNode => {
  const existing = getOperationContentMap[path];
  if (existing) {
    if (existing.kind === Kind.DOCUMENT) return existing as DocumentNode;
    return (getOperationContentMap[path] as Record<string, DocumentNode>)[
      operationName
    ];
  }

  const fileContent = readFileSync(path, "utf-8").replace(
    /#import "(.*)"/,
    (_, fragmentPath) => loadFile(join(dirname(path), fragmentPath)),
  );

  try {
    const sources = gqlPluckFromCodeStringSync(path, fileContent);
    getOperationContentMap[path] = Object.fromEntries(sources.map((s) => {
      const document = parse(s);
      const firstOp = document.definitions.find((d) =>
        d.kind === Kind.OPERATION_DEFINITION
      );
      if (!firstOp) throw new Error(`Cound not find an operation in ${path}`);

      return [firstOp.name?.value, document];
    }));
  } catch {
    getOperationContentMap[path] = parse(fileContent);
  }

  return getOperationContent(path, operationName);
};

// - Types will be suffixed with their type: fooQuery or fooMutation
export const init = <
  Query extends Record<
    string,
    { data: Record<string, unknown>; variables?: Record<string, unknown> }
  >,
  Mutation extends Record<
    string,
    { data: Record<string, unknown>; variables?: Record<string, unknown> }
  >,
  Subscription extends Record<
    string,
    { data: Record<string, unknown>; variables?: Record<string, unknown> }
  >,
  Types extends Record<string, Record<string, unknown>>,
  Inputs extends Record<string, Record<string, unknown>>,
  Extra = CovariantEmpty,
>(
  schema: string,
  queries: { [operation in keyof Query]: string },
  mutations: { [operation in keyof Mutation]: string },
  subscriptions: { [operation in keyof Subscription]: string },
  types: readonly (keyof Types & string)[],
  inputs: readonly (keyof Inputs & string)[],
  scalars: {
    [name: string]:
      | ((typeName: string, fieldName: string) => unknown)
      | string
      | number
      | boolean
      | null;
  },
  options?: {
    finalizeOperation?: <T extends OperationMock & Partial<Extra>>(
      operation: T,
    ) => T;
  },
) =>
<
  Transforms extends
    & MapObjectsToTransforms<Types & Inputs>
    & MapOperationsToTransforms<
      Query,
      Mutation,
      Subscription,
      Types,
      Inputs
    >,
>(
  fn: (
    b: Build<
      Query,
      Mutation,
      Subscription,
      Types,
      Inputs,
      ContravariantEmpty,
      Extra
    >,
  ) => Transforms,
): Build<Query, Mutation, Subscription, Types, Inputs, Transforms, Extra> => {
  const doc = parse(schema);

  type FullBuild = Build<
    Query,
    Mutation,
    Subscription,
    Types,
    Inputs,
    Transforms,
    Extra
  >;
  type BuildWithoutTransforms = Build<
    Query,
    Mutation,
    Subscription,
    Types,
    Inputs,
    ContravariantEmpty,
    Extra
  >;

  const build: Partial<FullBuild> = {};

  const transforms = fn(
    build as BuildWithoutTransforms,
  );

  type GenericObjectPatch = Patch<(Types & Inputs)[keyof Types & string]>;
  const addObjectTransforms = (type: string, obj: unknown) => {
    Object.defineProperty(obj, "patch", {
      value: (...patches: GenericObjectPatch[]) =>
        build[type]!(
          (typeof obj === "function" ? obj() : obj) as GenericObjectPatch,
          ...patches,
        ),
    });
    Object.defineProperties(
      obj,
      Object.fromEntries(
        Object.entries(transforms[type] ?? {}).map((
          [name, fn],
        ) => [name, {
          value: (...args: unknown[]) => {
            const prev = typeof obj === "function" ? obj() : obj;
            const patch = (typeof fn === "function"
              ? fn(prev, ...args)
              : fn) as GenericObjectPatch;
            return build[type]!(
              prev as GenericObjectPatch,
              patch as GenericObjectPatch,
            );
          },
        }]),
      ),
    );
    return obj;
  };

  const wrap = <T>(type: string, patches: Patch<T>[]) =>
    withGetDefaultPatch(
      <U>(type: string) => transforms[type]?.default as Patch<U>,
      () => toObject(proxy<T>(doc.definitions, scalars, type, ...patches)),
    );

  const objectBuilder = <T>(type: string) =>
    addObjectTransforms(type, (...patches: (Patch<T>)[]) => {
      if (transforms[type] && "default" in transforms[type]) {
        patches = [
          transforms[type].default as Patch<T>,
          ...patches,
        ];
      }
      return addObjectTransforms(type, wrap(type, patches));
    });

  for (const type of types) {
    build[type as keyof Types] = objectBuilder(
      type,
    ) as FullBuild[keyof Types];
  }

  for (const input of inputs) {
    build[input as keyof Inputs] = objectBuilder(
      input,
    ) as FullBuild[keyof Inputs];
  }

  const resolveOperationConflicts = (
    operation: string,
    kind: string,
    otherNames: string[],
  ): keyof FullBuild => {
    if (!otherNames.includes(operation)) return operation;
    return `${kind}${operation[0].toUpperCase()}${operation.slice(1)}`;
  };

  type OperationPatch = Shift<
    Shift<Shift<Parameters<typeof operation>>>
  >[number];

  const addOperationTransforms = (operation: string, obj: unknown) => {
    Object.defineProperties(obj, {
      patch: {
        value: (...patches: OperationPatch[]) => {
          const prev = typeof obj === "function" ? obj() : obj;
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, error, ...rest } = prev;
          return builder(
            {
              data: result.data,
              variables: request.variables,
              error: error,
              errors: result.errors,
              ...rest,
            },
            ...patches,
          );
        },
      },
      variables: {
        value: (variables: Patch<unknown>) => {
          const prev = typeof obj === "function" ? obj() : obj;
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, error, ...rest } = prev;
          const mock = builder(
            {
              data: result.data,
              variables: request.variables,
              error: error,
              errors: result.errors,
              ...rest,
            },
            {
              variables: typeof variables === "function"
                ? variables(result.data, request.variables)
                : variables,
            },
          );
          Error.captureStackTrace(
            mock,
            (obj as { variables: Function }).variables,
          );
          mock.stack = mock.stack?.slice(6);
          return mock;
        },
      },
      data: {
        value: (data: Patch<unknown>) => {
          const prev = typeof obj === "function" ? obj() : obj;
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, error, ...rest } = prev;
          const mock = builder(
            {
              data: result.data,
              variables: request.variables,
              error: error,
              errors: result.errors,
              ...rest,
            },
            {
              data: typeof data === "function"
                ? data(request.variables, result.data)
                : data,
            },
          );
          Error.captureStackTrace(
            mock,
            (obj as { data: Function }).data,
          );
          mock.stack = mock.stack?.slice(6);
          return mock;
        },
      },
    });
    Object.defineProperties(
      obj,
      Object.fromEntries(
        Object.entries(transforms[operation] ?? {}).map((
          [name, fn],
        ) => [name, {
          value: (...args: unknown[]) => {
            const prev = typeof obj === "function" ? obj() : obj;
            const prevInput = {
              data: prev.result.data,
              variables: prev.request.variables,
              error: prev.error,
              errors: prev.result.errors,
            };
            const operationFn = fn as OperationPatch as (
              prev: SimpleOperationMock,
              ...args: unknown[]
            ) => OperationPatch;
            const patch = (typeof operationFn === "function"
              ? operationFn(prevInput, ...args)
              : operationFn) as GenericObjectPatch;
            const builder = build[operation]! as (
              ...patches: OperationPatch[]
            ) => OperationMock;
            const mock = builder(
              prevInput,
              patch as GenericObjectPatch,
            );
            Error.captureStackTrace(
              mock,
              (obj as Record<string, Function>)[name],
            );
            mock.stack = mock.stack?.slice(6);
            return mock;
          },
        }]),
      ),
    );
    return obj;
  };

  const operationBuilder = (name: string, path: string) => {
    const builder = (...patches: OperationPatch[]) => {
      const query = getOperationContent(path, name);
      if (transforms[name] && "default" in transforms[name]) {
        patches = [transforms[name].default as OperationPatch, ...patches];
      }
      const { request: { query: parsedQuery, ...request }, ...raw } = operation(
        doc.definitions,
        scalars,
        query,
        ...patches,
      );
      const mock = toObject({
        request: { ...request },
        ...raw,
      }) as ReturnType<typeof operation>;
      mock.request.query = parsedQuery;
      Error.captureStackTrace(mock, builder);
      mock.stack = mock.stack?.slice(6);
      return addOperationTransforms(
        name,
        options?.finalizeOperation
          ? options.finalizeOperation(mock as OperationMock & Partial<Extra>)
          : mock,
      );
    };
    return addOperationTransforms(name, builder) as FullBuild[keyof FullBuild];
  };

  {
    const nonQueryNames: string[] = [
      ...Object.keys(mutations),
      ...Object.keys(subscriptions),
      ...types,
      ...inputs,
    ];
    for (const query in queries) {
      build[resolveOperationConflicts(query, "query", nonQueryNames)] =
        // deno-lint-ignore no-explicit-any
        operationBuilder(query, queries[query]) as any;
    }
  }

  {
    const nonMutationNames: string[] = [
      ...Object.keys(queries),
      ...Object.keys(subscriptions),
      ...types,
      ...inputs,
    ];
    for (const mutation in mutations) {
      build[resolveOperationConflicts(mutation, "mutation", nonMutationNames)] =
        // deno-lint-ignore no-explicit-any
        operationBuilder(mutation, mutations[mutation]) as any;
    }
  }

  {
    const nonSubscriptionNames: string[] = [
      ...Object.keys(queries),
      ...Object.keys(mutations),
      ...types,
      ...inputs,
    ];
    for (const subscription in subscriptions) {
      build[
        resolveOperationConflicts(
          subscription,
          "subscription",
          nonSubscriptionNames,
        )
        // deno-lint-ignore no-explicit-any
      ] = operationBuilder(subscription, subscriptions[subscription]) as any;
    }
  }

  return build as FullBuild;
};
