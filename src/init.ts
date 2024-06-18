import {
  DefinitionNode,
  DocumentNode,
  EnumTypeDefinitionNode,
  ObjectTypeDefinitionNode,
  OperationDefinitionNode,
  parse,
} from "npm:graphql";

// If a collision is detected:
// - Operations will be prefixed with their operation: queryFoo or mutateFoo

import {
  Build,
  EmptyObject,
  MapObjectsToTransforms,
  MapOperationsToTransforms,
  ObjectBuilder,
  OperationBuilder,
  OperationMock,
  Options,
  Patch,
} from "./types.ts";
import { raise } from "./util.ts";

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";

const operationSchemas: Record<
  string,
  { query: string; node: DocumentNode } | undefined
> = {};
const getOperationSchema = (path: string) => {
  if (path in operationSchemas) return operationSchemas[path]!;
  const query = Deno.readTextFileSync(path);
  const node = parse(query);
  return operationSchemas[path] = { query, node };
};

const buildOperation = (
  name: string,
  path: string,
  kind: "query" | "mutation" | "subscription",
  names: string[],
  schema: readonly DefinitionNode[],
  transforms: UntypedTransforms,
  build: Record<
    string,
    (
      overrides?: unknown,
      current?: unknown,
      root?: unknown,
      field?: string,
      ancestors?: unknown[],
    ) => unknown
  >,
  scalars: {
    [name: string]: ((object: string, field: string) => unknown) | unknown;
  },
): [string, OperationBuilder] => {
  if (names.includes(name)) {
    name = `${kind}${name[0].toUpperCase()}${name.slice(1)}`;
  }

  const getOperationTransforms = (mock: OperationMock) => {
    const operationTransforms: PropertyDescriptorMap = {
      patch: {
        // configurable: true,
        value: (
          patch:
            | Record<string, unknown>
            | ((prev: Record<string, unknown>) => Record<string, unknown>),
        ) => builder(typeof patch === "function" ? patch(mock) : patch, mock),
      },
    };

    for (const transformName in transforms[name] ?? {}) {
      if (transformName in mock) continue;
      const transform = transforms[name]![transformName];
      operationTransforms[transformName] = {
        // configurable: true,
        value: (...args: unknown[]) =>
          builder(
            typeof transform === "function"
              ? transform(mock, ...args)
              : transform,
            mock,
          ),
      };
    }

    return operationTransforms;
  };

  const builder = (options?: Options, mock?: OperationMock) => {
    const { query, node } = getOperationSchema(path);

    // if (!mock) mock = { request: { query }, result: {} };
    // else
    const prevVariables = mock?.request.variables;
    mock = { request: { query }, result: { ...mock?.result } };
    if (prevVariables) mock.request.variables = prevVariables;

    const operation = node.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    );
    if (!operation) {
      throw new Error(`Could not find operation definition in '${name}'`);
    }

    const defaultGenerator = transforms[name]?.default;
    const defaults =
      (typeof defaultGenerator === "function"
        ? defaultGenerator()
        : defaultGenerator) ?? {};
    const dataDefault = (defaults.data as Record<string, unknown>) ?? {};
    const variablesDefault = (defaults.variables as Record<string, unknown>) ??
      {};

    const variablesOverride = options?.variables ?? {};
    for (const variable of operation.variableDefinitions ?? []) {
      const name = variable.variable.name.value;
      if (name in variablesOverride) {
        if (!mock.request.variables) mock.request.variables = {};
        mock.request.variables[name] =
          typeof variablesOverride[name] === "function"
            ? (variablesOverride[name] as () => unknown)()
            : variablesOverride[name];
        if (
          mock.request.variables[name] != null ||
          variable.type.kind !== "NonNullType"
        ) continue;
      }

      if (
        mock.request.variables && name in mock.request.variables &&
        (mock.request.variables[name] != null ||
          variable.type.kind !== "NonNullType")
      ) continue;

      if (name in variablesDefault) {
        const override: unknown =
          variablesDefault[name as keyof typeof variablesDefault];
        if (!mock.request.variables) mock.request.variables = {};
        mock.request.variables[name] = typeof override === "function"
          ? override()
          : override;
        if (
          mock.request.variables[name] != null ||
          variable.type.kind !== "NonNullType"
        ) continue;
      }

      if (variable.type.kind === "NonNullType") {
        if (!mock.request.variables) mock.request.variables = {};
        if (variable.type.type.kind === "ListType") {
          mock.request.variables[name] = [];
        } else {
          // This is mostly a copy of the obj builder...
          const fieldType = variable.type.type;
          const typeBuilder = build[fieldType.name.value];
          if (typeof typeBuilder === "function") {
            mock.request.variables[name] = typeBuilder(
              {},
              mock.request.variables[name],
              mock.request.variables,
              name,
            );
            continue;
          }

          const enumDef = schema.find((d): d is EnumTypeDefinitionNode =>
            d.kind === "EnumTypeDefinition" &&
            d.name.value === fieldType.name.value && !!d.values?.length
          );
          if (enumDef?.values) {
            mock.request.variables[name] = enumDef.values[0].name.value;
            continue;
          }

          if (!(fieldType.name.value in scalars)) {
            throw new Error(
              `Type '${fieldType.name.value}' is not defined`,
            );
          }
          const scalarDef = scalars[fieldType.name.value];
          mock.request.variables[name] = typeof scalarDef === "function"
            ? scalarDef(name, name)
            : scalarDef;
        }
      }
    }

    const rootSchema = schema.find((n): n is ObjectTypeDefinitionNode =>
      n.kind === "ObjectTypeDefinition" && n.name.value.toLowerCase() === kind
    );
    if (!rootSchema) throw new Error(`Could not find ${kind} in schema`);

    const root: Record<string, unknown> = mock.result.data ?? {};
    mock.result.data = root;

    const rawData = options?.data;
    const dataOverride: Patch<Record<string, unknown>> =
      typeof rawData === "function"
        ? rawData(variablesOverride)
        : rawData ?? {};

    for (const selection of operation.selectionSet.selections) {
      if (selection.kind !== "Field") {
        throw new Error(
          `Expect top-level selection of operations to consist of fields, got '${selection.kind}'`,
        );
      }

      const key = selection.alias?.value ?? selection.name.value;
      let type = rootSchema.fields?.find((f) =>
        f.name.value === selection.name.value
      )?.type;
      if (!type) {
        throw new Error(
          `Could not find type of '${selection.name.value}' on ${kind}`,
        );
      }

      if (type.kind !== "NonNullType") {
        if (!(key in dataOverride) && !(key in dataDefault) && !(key in root)) {
          root[key] = null;
          continue;
        }
      } else type = type.type;

      // Should merge these...?
      // const override = key in dataOverride ? dataOverride[key] : defaults[key];

      if (type.kind === "ListType") {
        root[key] = root[key] ?? []; // TODO
        continue;
      }

      const extractTypename = (thing: unknown) => {
        if (typeof thing === "function") thing = thing();
        if (!thing || typeof thing !== "object" || !("__typename" in thing)) {
          return;
        }
        if (typeof thing.__typename === "string") return thing.__typename;
        if (typeof thing.__typename === "function") {
          return thing.__typename(thing);
        }
      };

      const typename = extractTypename(dataOverride[key]) ??
        extractTypename(dataDefault[key]) ?? (() => {
          const schemaType = schema.find((d) =>
            "name" in d && d.name?.value === type.name.value
          );
          if (!schemaType) {
            throw new Error(`Could not find type of '${type.name.value}'`);
          }
          if (schemaType.kind === "InterfaceTypeDefinition") {
            const first = schema.find((d): d is ObjectTypeDefinitionNode =>
              d.kind === "ObjectTypeDefinition"
                ? d.interfaces?.some((i) => i.name.value === type.name.value) ??
                  false
                : false
            );
            if (!first) {
              throw new Error(
                `Could not find implementation for interface '${type.name.value}'`,
              );
            }
            return first.name.value;
          } else if (schemaType.kind === "ObjectTypeDefinition") {
            return schemaType.name.value;
          }
          throw new Error(`Unhandled kind ${schemaType.kind}`);
        })();

      root[key] = build[typename](
        dataOverride[key] ?? dataDefault[key],
        root[key],
        undefined,
        undefined,
        [root, mock.request.variables],
      );
    }

    Object.defineProperties(mock, getOperationTransforms(mock));

    return mock;
  };

  Object.defineProperties(
    builder,
    getOperationTransforms({
      request: { query: "TO BE REPLACED" },
      result: {},
    }),
  );

  return [name, builder as OperationBuilder];
};

type UntypedTransforms = Record<
  string,
  | Record<
    string,
    Record<string, unknown> | ((...args: unknown[]) => Record<string, unknown>)
  >
  | undefined
>;

const buildObject = (
  name: string,
  schema: readonly DefinitionNode[],
  scalars: {
    [name: string]: ((object: string, field: string) => unknown) | unknown;
  },
  build: Record<
    string,
    (
      overrides?: unknown,
      current?: unknown,
      root?: unknown,
      field?: string,
      ancestors?: unknown[],
    ) => unknown
  >,
  transforms: UntypedTransforms,
): ObjectBuilder<unknown, unknown> => {
  const type =
    schema.find((d): d is ObjectTypeDefinitionNode =>
      (d.kind === "ObjectTypeDefinition" ||
        d.kind === "InputObjectTypeDefinition") &&
      d.name.value === name
    ) ?? raise(`Could not find object type definition '${name}'`);

  const arr: Record<string, unknown>[] = [];

  const getObjTransforms = (obj: Record<string, unknown>) => {
    const objTransforms: PropertyDescriptorMap = {
      patch: {
        configurable: true,
        value: (
          patch:
            | Record<string, unknown>
            | ((prev: Record<string, unknown>) => Record<string, unknown>),
        ) =>
          builder(typeof patch === "function" ? patch(obj) : patch, { ...obj }),
      },
    };

    for (const transformName in transforms[name] ?? {}) {
      if (transformName in obj) continue;
      const transform = transforms[name]![transformName];
      objTransforms[transformName] = {
        value: (...args: unknown[]) =>
          builder(
            typeof transform === "function"
              ? transform(obj, ...args)
              : transform,
            { ...obj },
          ),
      };
    }

    return objTransforms;
  };

  const builder = (
    overrides?: Record<string, unknown>,
    obj: Record<string, unknown> = {},
    root?: unknown,
    field?: string,
    ancestors: unknown[] = [],
  ) => {
    if (!obj || typeof obj !== "object") obj = {};
    if (!root) root = obj;
    else if (field) root = { ...root, [field]: obj };

    obj.__typename = name;

    const defaultTransform = transforms[name]?.default ?? {};
    const defaults = typeof defaultTransform === "function"
      ? defaultTransform(obj)
      : defaultTransform;
    for (const field of type.fields ?? []) {
      if (overrides && field.name.value in overrides) {
        const override = overrides[field.name.value];
        const value = typeof override === "function"
          ? override(root, ...ancestors)
          : override;

        if (isObject(value)) {
          let fieldType = field.type;
          while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
          const typeBuilder = build[fieldType.name.value];
          if (typeBuilder) {
            obj[field.name.value] = typeBuilder(
              value,
              obj[field.name.value],
              root,
              field.name.value,
              [obj, ...ancestors],
            );
          } else {
            console.warn(
              `Didn't find builder for '${fieldType.name.value}', replacing entirely`,
            );
            obj[field.name.value] = value;
          }
        } else obj[field.name.value] = value;
        if (value != null || field.type.kind !== "NonNullType") continue;
        else delete obj[field.name.value];
      }

      if (field.name.value in obj) {
        // do nothing; it's already set!
      } else if (field.name.value in defaults) {
        const d = defaults[field.name.value];
        const value = typeof d === "function" ? d(root, ...ancestors) : d;
        if (isObject(value)) {
          let fieldType = field.type;
          while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
          const typeBuilder = build[fieldType.name.value];
          if (typeBuilder) {
            obj[field.name.value] = typeBuilder(
              Object.assign(
                {},
                obj[field.name.value],
                value,
                overrides ? overrides[field.name.value] : {},
                [obj, ...ancestors],
              ),
            );
          } else obj[field.name.value] = value;
        } else obj[field.name.value] = value;
      } else if (field.type.kind !== "NonNullType") {
        obj[field.name.value] = null;
      } else if (field.type.type.kind === "ListType") {
        obj[field.name.value] = [];
      } else {
        const fieldType = field.type.type;
        const typeBuilder = build[fieldType.name.value];
        if (typeBuilder) {
          obj[field.name.value] = typeBuilder(
            {},
            obj[field.name.value],
            obj,
            field.name.value,
            [obj, ...ancestors],
          );
          continue;
        }

        const enumDef = schema.find((d): d is EnumTypeDefinitionNode =>
          d.kind === "EnumTypeDefinition" &&
          d.name.value === fieldType.name.value && !!d.values?.length
        );
        if (enumDef?.values) {
          obj[field.name.value] = enumDef.values[0].name.value;
          continue;
        }

        if (!(fieldType.name.value in scalars)) {
          throw new Error(
            `Type '${fieldType.name.value}' is not defined`,
          );
        }
        const scalarDef = scalars[field.type.type.name.value];
        obj[field.name.value] = typeof scalarDef === "function"
          ? scalarDef(name, field.name.value)
          : scalarDef;
      }
    }

    Object.defineProperties(obj, getObjTransforms(obj));

    return obj;
  };

  Object.defineProperties(builder, {
    length: { get: () => arr.length },
    find: { value: arr.find.bind(arr) },
    findBy: {
      value: (value: unknown, key: string = "id") =>
        arr.find((v) => v[key] === value),
    },
    last: { get: () => arr[arr.length - 1] },
    ...getObjTransforms({}),
  });

  return builder as unknown as ObjectBuilder<unknown, unknown>;
};

// - Types will be suffixed with their type: fooQuery or fooMutation
export const init = <
  Queries,
  Mutations,
  Subscriptions,
  Types extends Record<string, Record<string, unknown>>,
  Inputs extends Record<string, Record<string, unknown>>,
>(
  schema: string,
  queries: { [operation in keyof Queries]: string },
  mutations: { [operation in keyof Mutations]: string },
  subscriptions: { [operation in keyof Subscriptions]: string },
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
      Queries,
      Mutations,
      Subscriptions,
      Types,
      Inputs
    >,
>(
  fn: (
    b: Build<Queries, Mutations, Subscriptions, Types, Inputs, EmptyObject>,
  ) => Transforms,
): Build<
  Queries,
  Mutations,
  Subscriptions,
  Types,
  Inputs,
  Transforms
> => {
  const doc = parse(schema);

  const build: Partial<
    Build<Queries, Mutations, Subscriptions, Types, Inputs, Transforms>
  > = {};

  const transforms = fn(
    build as Build<
      Queries,
      Mutations,
      Subscriptions,
      Types,
      Inputs,
      EmptyObject
    >,
  );

  for (const type of types) {
    type K = keyof typeof build;
    build[type as K] = buildObject(
      type,
      doc.definitions,
      scalars,
      // deno-lint-ignore no-explicit-any
      build as any,
      transforms as UntypedTransforms,
    ) as typeof build[K];
  }

  for (const input of inputs) {
    type K = keyof typeof build;
    build[input as K] = buildObject(
      input,
      doc.definitions,
      scalars,
      // deno-lint-ignore no-explicit-any
      build as any,
      transforms as UntypedTransforms,
    ) as typeof build[K];
  }

  {
    const nonQueryNames: string[] = [
      ...Object.keys(mutations),
      ...Object.keys(subscriptions),
      ...types,
      ...inputs,
    ];
    for (const query in queries) {
      const [key, value] = buildOperation(
        query,
        queries[query],
        "query",
        nonQueryNames,
        doc.definitions,
        transforms as UntypedTransforms,
        // deno-lint-ignore no-explicit-any
        build as any,
        scalars,
      );
      type K = keyof typeof build;
      build[key as K] = value as typeof build[K];
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
      const [key, value] = buildOperation(
        mutation,
        mutations[mutation],
        "mutation",
        nonMutationNames,
        doc.definitions,
        transforms as UntypedTransforms,
        // deno-lint-ignore no-explicit-any
        build as any,
        scalars,
      );
      type K = keyof typeof build;
      build[key as K] = value as typeof build[K];
    }
  }

  Object.assign(
    transforms,
    fn(
      build as Build<
        Queries,
        Mutations,
        Subscriptions,
        Types,
        Inputs,
        EmptyObject
      >,
    ),
  );

  return build as Build<
    Queries,
    Mutations,
    Subscriptions,
    Types,
    Inputs,
    Transforms
  >;
};
