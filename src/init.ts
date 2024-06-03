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
  InferTransforms,
  OperationBuilder,
  OperationMock,
  Options,
} from "./types.ts";
import { raise } from "./util.ts";
import { ObjectBuilder } from "./types.ts";
import { Queries, Subscriptions } from "../examples/board/types.ts";

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

const initOperation = (
  name: string,
  path: string,
  kind: "query" | "mutation" | "subscription",
  names: string[],
  schema: readonly DefinitionNode[],
): [string, OperationBuilder] => {
  if (names.includes(name)) {
    name = `${kind}${name[0].toUpperCase()}${name.slice(1)}`;
  }

  const builder = (_options?: Options) => {
    const { query, node } = getOperationSchema(path);

    const mock: OperationMock = {
      request: { query },
      result: {},
    };

    const operation = node.definitions.find((
      d,
    ): d is OperationDefinitionNode => d.kind === "OperationDefinition");
    if (!operation) {
      throw new Error(`Could not find operation definition in '${name}'`);
    }

    if (operation.variableDefinitions?.length) {
      mock.request.variables = {};
    }

    console.log(
      operation.variableDefinitions?.map((v) => v.variable.name.value),
    );

    return mock;
  };

  return [name, builder as OperationBuilder];
};

type UntypedTransforms = Record<
  string,
  Record<string, Record<string, unknown>> | undefined
>;

const initObject = (
  name: string,
  schema: readonly DefinitionNode[],
  scalars: {
    [name: string]: ((object: string, field: string) => unknown) | unknown;
  },
  container: Record<
    string,
    (overrides?: unknown, root?: unknown, field?: string) => unknown
  >,
  transforms: UntypedTransforms,
): ObjectBuilder<unknown, unknown> => {
  const type =
    schema.find((d): d is ObjectTypeDefinitionNode =>
      d.kind === "ObjectTypeDefinition" && d.name.value === name
    ) ?? raise(`Could not find object type definition '${name}'`);

  const arr: unknown[] = [];

  const builder = Object.assign(
    (overrides?: Record<string, unknown>, root?: unknown, field?: string) => {
      const obj: Record<string, unknown> = {};
      if (!root) root = obj;
      else if (field) root = { ...root, [field]: obj };

      const defaults = transforms[name]?.default ?? {};
      for (const field of type.fields ?? []) {
        if (overrides && field.name.value in overrides) {
          const override = overrides[field.name.value];
          const value = typeof override === "function"
            ? override(root)
            : override;
          if (isObject(value)) {
            let fieldType = field.type;
            while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
            const typeBuilder = container[fieldType.name.value];
            if (typeBuilder) {
              obj[field.name.value] = typeBuilder(
                value,
                root,
                field.name.value,
              );
            } else obj[field.name.value] = value;
          } else obj[field.name.value] = value;
        } else if (field.name.value in defaults) {
          const d = defaults[field.name.value];
          const value = typeof d === "function" ? d(root) : d;
          if (isObject(value)) {
            let fieldType = field.type;
            while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
            const typeBuilder = container[fieldType.name.value];
            if (typeBuilder) {
              obj[field.name.value] = typeBuilder(
                Object.assign(
                  {},
                  value,
                  overrides ? overrides[field.name.value] : {},
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
          const typeBuilder = container[fieldType.name.value];
          if (typeBuilder) {
            obj[field.name.value] = typeBuilder();
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
      return obj;
    },
    {
      findBy: (value: string, key: string = "id") =>
        arr.find((v) => isObject(v) && key in v && v[key] === value),
    },
  );

  Object.defineProperties(builder, {
    length: { get: () => arr.length },
    find: { value: arr.find.bind(arr) },
  });

  return builder as ObjectBuilder<unknown, unknown>;
};

export const transforms = <
  Transforms extends InferTransforms<
    unknown,
    Mutations,
    Subscriptions,
    Types,
    Inputs
  >,
>(
  transforms: Transforms,
) => transforms;

// - Types will be suffixed with their type: fooQuery or fooMutation
export const init = <
  Queries,
  Mutations,
  Subscriptions,
  Types,
  Inputs,
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
  Transforms extends InferTransforms<
    Queries,
    Mutations,
    Subscriptions,
    Types,
    Inputs
  >,
>(
  fn: (
    build: Build<Queries, Mutations, Subscriptions, Types, Inputs, EmptyObject>,
    fn2: (
      transforms: Transforms,
    ) => Transforms,
  ) => Transforms,
) => {
  const doc = parse(schema);

  const transforms: Partial<Transforms> = {};

  const container: Partial<
    Build<Queries, Mutations, Subscriptions, Types, Inputs, Transforms>
  > = {};

  for (const type of types) {
    type K = keyof typeof container;
    container[type as K] = initObject(
      type,
      doc.definitions,
      scalars,
      container as Build<
        Queries,
        Mutations,
        Subscriptions,
        Types,
        Inputs,
        Transforms
      >,
      transforms as UntypedTransforms,
    ) as typeof container[K];
  }

  {
    const nonQueryNames: string[] = [
      ...Object.keys(mutations),
      ...Object.keys(subscriptions),
      ...types,
      ...inputs,
    ];
    for (const query in queries) {
      const [key, value] = initOperation(
        query,
        queries[query],
        "query",
        nonQueryNames,
        doc.definitions,
      );
      type K = keyof typeof container;
      container[key as K] = value as typeof container[K];
    }
  }

  Object.assign(
    transforms,
    fn(
      container as Build<
        Queries,
        Mutations,
        Subscriptions,
        Types,
        Inputs,
        EmptyObject
      >,
      (v) => v,
    ),
  );

  return container as Build<
    Queries,
    Mutations,
    Subscriptions,
    Types,
    Inputs,
    Transforms
  >;
};
