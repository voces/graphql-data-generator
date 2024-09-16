import { readFileSync } from "node:fs";
import { parse } from "npm:graphql";
import { dirname, join } from "node:path";

import {
  Build,
  EmptyObject,
  MapObjectsToTransforms,
  MapOperationsToTransforms,
  Shift,
} from "./extendedTypes.ts";
import { OperationMock, Patch, SimpleOperationMock } from "./types.ts";
import { operation, proxy, withGetDefaultPatch } from "./proxy.ts";
import { toObject } from "./util.ts";

const files: Record<string, string> = {};
const loadFile = (path: string): string =>
  files[path] = readFileSync(path, "utf-8").replace(
    /#import "(.*)"/,
    (_, fragmentPath) => loadFile(join(dirname(path), fragmentPath)),
  );

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
    b: Build<Query, Mutation, Subscription, Types, Inputs, EmptyObject>,
  ) => Transforms,
): Build<Query, Mutation, Subscription, Types, Inputs, Transforms> => {
  const doc = parse(schema);

  type FullBuild = Build<
    Query,
    Mutation,
    Subscription,
    Types,
    Inputs,
    Transforms
  >;
  type BuildWithoutTransforms = Build<
    Query,
    Mutation,
    Subscription,
    Types,
    Inputs,
    EmptyObject
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

  const objectBuilder = <T, K extends keyof FullBuild>(type: string) =>
    addObjectTransforms(type, (...patches: Patch<T>[]) => {
      if (transforms[type] && "default" in transforms[type]) {
        patches = [transforms[type].default as Patch<T>, ...patches];
      }
      return addObjectTransforms(type, wrap(type, patches));
    }) as FullBuild[K];

  for (const type of types) {
    build[type as keyof Types] = objectBuilder(type);
  }

  for (const input of inputs) {
    build[input as keyof Inputs] = objectBuilder(input);
  }

  const resolveOperationConflicts = (
    operation: string,
    kind: string,
    otherNames: string[],
  ): keyof FullBuild => {
    if (!otherNames.includes(operation)) return operation;
    return `${kind}${name[0].toUpperCase()}${name.slice(1)}`;
  };

  type OperationPatch = Shift<
    Shift<Shift<Parameters<typeof operation>>>
  >[number];

  const addOperationTransforms = (operation: string, obj: unknown) => {
    Object.defineProperty(obj, "patch", {
      value: (...patches: OperationPatch[]) => {
        const prev = typeof obj === "function" ? obj() : obj;
        const builder = build[operation]! as (
          ...patches: OperationPatch[]
        ) => OperationMock;
        return builder(
          {
            data: prev.result.data,
            variables: prev.request.variables,
            error: prev.error,
            errors: prev.result.errors,
          },
          ...patches,
        );
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
            return builder(
              prevInput,
              patch as GenericObjectPatch,
            );
          },
        }]),
      ),
    );
    return obj;
  };

  const operationBuilder = (name: string, path: string) =>
    addOperationTransforms(name, (...patches: OperationPatch[]) => {
      const query = files[path] ?? loadFile(path);
      if (transforms[name] && "default" in transforms[name]) {
        patches = [transforms[name].default as OperationPatch, ...patches];
      }
      return addOperationTransforms(
        name,
        toObject(operation(doc.definitions, scalars, query, ...patches)),
      );
    }) as FullBuild[keyof FullBuild];

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
