import {
  ConstValueNode,
  DefinitionNode,
  EnumTypeDefinitionNode,
  GraphQLError,
  InterfaceTypeDefinitionNode,
  Kind,
  NameNode,
  ObjectTypeDefinitionNode,
  OperationDefinitionNode,
  TypeNode,
} from "npm:graphql";
import { OperationMock, Patch } from "./types.ts";
import { parse } from "npm:graphql";
import { absurd } from "./util.ts";

type NamedDefinitionNode = DefinitionNode & { name: NameNode };

const resolveType = (definitions: readonly DefinitionNode[], type: string) => {
  console.log("resolveType", type);
  const path = type.split(".");
  let definition: (NamedDefinitionNode) | undefined;
  let parent: string | undefined;
  for (const name of path) {
    if (!definition) {
      definition = definitions.find((d): d is NamedDefinitionNode =>
        "name" in d && d.name?.value === name
      );
    } else {
      parent = definition.name.value;
      const field = "fields" in definition
        ? definition.fields?.find((f) => f.name.value === name)
        : undefined;
      if (!field) {
        throw new Error(
          `Could not find ${name} on ${
            "name" in definition ? definition.name?.value : "<unknown>"
          }`,
        );
      }
      let type = field.type;
      while (type.kind !== Kind.NAMED_TYPE) type = type.type;
      definition = definitions.find((d): d is NamedDefinitionNode =>
        "name" in d ? d.name?.value === type.name.value : false
      );
      if (!definition) {
        throw new Error(
          `Could not find type ${type.name.value}`,
        );
      }
    }
    if (!definition) {
      throw new Error(
        `Could not find type ${name}${parent ? ` on ${parent}` : ""}`,
      );
    }
  }
  return { parent, definition };
};

const resolveConcreteType = <T>(
  definitions: readonly DefinitionNode[],
  definition: InterfaceTypeDefinitionNode,
  patches: Patch<T>[],
) => {
  const objectDefintions = definitions.filter((
    d,
  ): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION);
  const interfaceDefintions = definitions.filter((
    d,
  ): d is InterfaceTypeDefinitionNode =>
    d.kind === Kind.INTERFACE_TYPE_DEFINITION
  );

  let options: ObjectTypeDefinitionNode[] = [];
  const interfaces = [definition];
  while (interfaces.length) {
    const interfaceDefinition = interfaces.pop()!;
    for (const objectDefintion of objectDefintions) {
      if (
        objectDefintion.interfaces?.some((i) =>
          i.name.value === interfaceDefinition.name.value
        )
      ) options.push(objectDefintion);
    }
    for (const secondOrderInterfaceDefinition of interfaceDefintions) {
      if (
        secondOrderInterfaceDefinition.interfaces?.some((i) =>
          i.name.value === interfaceDefinition.name.value
        )
      ) interfaces.push(secondOrderInterfaceDefinition);
    }
  }

  if (options.length === 1) return options[0];

  for (let i = patches.length - 1; i >= 0; i--) {
    for (const field in patches[i]) {
      options = options.filter((o) =>
        o.fields?.some((f) => f.name.value === field)
      );
      if (options.length === 1) return options[0];
    }
  }

  if (options.length === 0) {
    throw new Error(
      `Could not find concrete type for ${definition.name.value}`,
    );
  }

  return options[0];
};

const resolveValue = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  type: TypeNode,
  ctx: {
    hostType: string;
    prop: string;
    // patches: Patch<T>[];
  },
) => {
  if (type.kind !== Kind.NON_NULL_TYPE) return null;
  if (type.type.kind === Kind.LIST_TYPE) return [];

  type = type.type;
  const fieldTypeDefinitions = definitions.filter((d) =>
    "name" in d &&
    d.name?.value === type.name.value
  );

  if (
    fieldTypeDefinitions.length &&
    fieldTypeDefinitions.every((d) => d.kind === Kind.ENUM_TYPE_DEFINITION)
  ) {
    return fieldTypeDefinitions.find(
      (d): d is EnumTypeDefinitionNode =>
        d.kind === Kind.ENUM_TYPE_DEFINITION && (d.values?.length ?? 0) > 0,
    )?.values?.[0].name.value;
  }

  if (
    fieldTypeDefinitions.every((d) => d.kind === Kind.SCALAR_TYPE_DEFINITION)
  ) {
    if (!(type.name.value in scalars)) {
      throw new Error(
        `Missing scalar ${type.name.value}`,
      );
    }
    // console.log("scalar", ctx.patches);
    const scalar = scalars[type.name.value];
    const value = typeof scalar === "function" ? scalar(ctx.hostType) : scalar;
    return value;
  }

  if (
    fieldTypeDefinitions.length === 1 &&
    (fieldTypeDefinitions[0].kind === Kind.OBJECT_TYPE_DEFINITION ||
      fieldTypeDefinitions[0].kind === Kind.INTERFACE_TYPE_DEFINITION ||
      fieldTypeDefinitions[0].kind === Kind.INPUT_OBJECT_TYPE_DEFINITION)
  ) {
    // const childPatches = ctx.patches.map((p) => p[ctx.prop as keyof typeof p])
    //   .filter((v) => !!v && typeof v === "object") as Patch<T[keyof T]>[];
    return _proxy<T[keyof T]>(
      definitions,
      scalars,
      fieldTypeDefinitions[0].name.value,
      undefined,
      [],
    );
  }

  throw new Error(
    `Unhandled default kind ${fieldTypeDefinitions.map((d) => d.kind)}`,
  );
};

const _proxy = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  type: string,
  prev: T | undefined,
  // selectionMap:
  patches: Patch<T>[],
): T => {
  const { parent = type, definition } = resolveType(definitions, type);
  if (!definition) throw new Error(`Could not find definition '${name}'`);

  switch (definition.kind) {
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_DEFINITION: {
      if (!prev) {
        prev = patches.length
          ? _proxy(
            definitions,
            scalars,
            parent,
            undefined,
            patches.slice(0, -1),
          )
          : undefined;
      }

      const getProp = (target: Partial<T>, prop: string | symbol) => {
        if (prop === "toJSON") return;
        if (prop === "__typename") return definition.name.value;
        if (prop in target) return target[prop as keyof T];
        if (typeof prop === "symbol") return target[prop as keyof T];

        const field = definition.fields?.find((f) => f.name.value === prop);
        if (!field) return target[prop as keyof T];

        // Get from patch
        if (patches.length > 0 && prop in patches[patches.length - 1]) {
          const rawValue = patches[patches.length - 1][prop as keyof Patch<T>];
          const value = typeof rawValue === "function"
            ? rawValue(prev)
            : rawValue;

          if (value && typeof value === "object") {
            const nonNullFieldType = field.type.kind === Kind.NON_NULL_TYPE
              ? field.type.type
              : field.type;

            if (nonNullFieldType.kind === Kind.LIST_TYPE) {
              const previousArray =
                (prev?.[prop as keyof T] ?? []) as unknown[];
              if (Array.isArray(value)) {
                return target[prop as keyof T] = value.map((v, i) =>
                  _proxy(
                    definitions,
                    scalars,
                    `${type}.${prop}`,
                    previousArray[i],
                    v ? [v] : [],
                  )
                ) as T[keyof T];
              } else {
                const lastIndex = Math.max(previousArray.length - 1, 0);
                const nextIndex = previousArray.length;
                const length = typeof value.length === "number"
                  ? value.length
                  : Math.max(
                    previousArray.length,
                    ...Object.keys(value).map((v) => {
                      const i = parseInt(v);
                      if (!Number.isNaN(i)) return i + 1;
                      if (v === "last") return lastIndex + 1;
                      if (v === "next") return nextIndex + 1;
                      if (v === "length") return 0;
                      throw new Error(`Unhandled array index ${v}`);
                    }),
                  );
                const arr = [] as T[keyof T] & unknown[];
                for (let i = 0; i < length; i++) {
                  arr[i] = _proxy(
                    definitions,
                    scalars,
                    `${type}.${prop}`,
                    previousArray[i],
                    [
                      value[i],
                      i === lastIndex ? value.last : undefined,
                      i === nextIndex ? value.next : undefined,
                    ].filter((v) => v != null),
                  );
                }
                return target[prop as keyof T] = arr;
              }
            }

            type Child = T[keyof T];
            const childPatches: Patch<Child>[] = patches.map((p) =>
              p[prop as keyof typeof p] as Patch<Child> | undefined
            ).filter((v): v is Patch<Child> => !!v && typeof v === "object");
            return target[prop as keyof T] = _proxy<Child>(
              definitions,
              scalars,
              `${parent}.${prop}`,
              undefined,
              childPatches,
            );
          }

          if (value !== undefined) {
            return target[prop as keyof T] = value as T[keyof T];
          }
        }

        // Get from prev proxy if available
        if (prev) return target[prop as keyof T] = prev[prop as keyof T];

        // Otherwise generate it from type
        return target[prop as keyof T] = resolveValue(
          definitions,
          scalars,
          field.type,
          { hostType: definition.name.value, prop },
        ) as T[keyof T];
      };

      return new Proxy({}, {
        get: getProp,
        set: (prev, prop, value) => {
          (prev as T & object)[prop as keyof T] = value;
          return true;
        },
        ownKeys: () => [
          ...(definition.kind === Kind.OBJECT_TYPE_DEFINITION
            ? ["__typename"]
            : []),
          ...definition.fields?.map((f) => f.name.value) ?? [],
        ],
        getOwnPropertyDescriptor: (target, prop) =>
          prop === "__typename" ||
            (definition.fields?.some((f) => f.name.value === prop) ??
              false)
            ? ({
              enumerable: true,
              configurable: true,
              value: getProp(target, prop),
              // get: () => getProp(target, prop),
            })
            : Object.getOwnPropertyDescriptor(target, prop),
      }) as T;
    }
    case Kind.INTERFACE_TYPE_DEFINITION: {
      const concreteType = resolveConcreteType(
        definitions,
        definition,
        patches,
      );
      return _proxy(
        definitions,
        scalars,
        concreteType.name.value,
        undefined,
        patches,
      );
    }
    case Kind.OPERATION_DEFINITION: {
      type Mock = {
        variables?: Record<string, unknown>;
        data: Record<string, unknown> | null;
        error?: Error;
        errors?: GraphQLError[];
      };

      const prev = patches.length
        ? _proxy<Mock>(
          definitions,
          scalars,
          type,
          undefined,
          patches.slice(0, -1) as Patch<Mock>[],
        )
        : undefined;

      // console.log("prev", prev);

      const mock: Mock = { data: null };
      const patch = patches[patches.length - 1] as Patch<Mock> | undefined;

      const variablePatch = typeof patch?.variables === "function"
        ? patch.variables(prev!)
        : patch?.variables;
      for (const variableDefinition of definition.variableDefinitions ?? []) {
        const name = variableDefinition.variable.name.value;

        if (patch) {
          if (variablePatch && name in variablePatch) {
            const rawValue = variablePatch[name];
            const value = typeof rawValue === "function"
              ? rawValue(prev!.variables)
              : rawValue;
            if (value && typeof value === "object") {
              let namedVariableType = variableDefinition.type;
              while (namedVariableType.kind !== Kind.NAMED_TYPE) {
                namedVariableType = namedVariableType.type;
              }

              if (!mock.variables) mock.variables = {};
              mock.variables[name] = _proxy<unknown>(
                definitions,
                scalars,
                namedVariableType.name.value,
                prev?.variables?.[name],
                [value],
              );
              continue;
            }

            if (value !== undefined) {
              if (!mock.variables) mock.variables = {};
              mock.variables[name] = value;
              continue;
            }
          }

          if (variableDefinition.defaultValue) {
            if (!mock.variables) mock.variables = {};
            mock.variables[name] = constToValue(
              variableDefinition.defaultValue,
            );
            continue;
          }
        }

        const result = resolveValue(
          definitions,
          scalars,
          variableDefinition.type,
          { hostType: type, prop: name },
        );
        if (result != null) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = result;
        }
      }

      const dataPatch = typeof patch?.data === "function"
        ? patch.data(prev!)
        : patch?.data;
      for (const selection of definition.selectionSet.selections ?? []) {
        // console.log(selection.kind);
        switch (selection.kind) {
          case Kind.FIELD: {
            const prop = selection.alias?.value ?? selection.name.value;
            const rawValue = dataPatch?.[prop];
            const value = typeof rawValue === "function"
              ? rawValue(prev)
              : rawValue;
            if (!mock.data) mock.data = {};
            const operationKey = definition.operation[0].toUpperCase() +
              definition.operation.slice(1);

            mock.data[prop] = _proxy(
              definitions,
              scalars,
              `${operationKey}.${selection.name.value}`,
              null,
              value ? [value] : [],
            );

            // console.log(selection.name.value, selection.alias?.value);
            continue;
          }
          case Kind.FRAGMENT_SPREAD:
          case Kind.INLINE_FRAGMENT:
            throw new Error(`Unhandled selection kind ${selection.kind}`);
          default:
            absurd(selection);
        }
      }

      if (patch) {
        if ("error" in patch) {
          const value = typeof patch.error === "function"
            ? patch.error(prev!)
            : patch.error;
          // TODO: what if an actual error patch is passed?
          mock.error = value as Error;
        }

        if ("errors" in patch) {
          const rawErrors = typeof patch.errors === "function"
            ? patch.errors(prev!)
            : patch.errors;
          if (Array.isArray(rawErrors) && rawErrors.length) {
            mock.errors = rawErrors as GraphQLError[];
          }
        }
      }

      return mock as T;
    }
    case Kind.SCALAR_TYPE_DEFINITION: {
      if (!(definition.name.value in scalars)) {
        throw new Error(
          `Missing scalar ${definition.name.value}`,
        );
      }
      // console.log("scalar", ctx.patches);
      const scalar = scalars[definition.name.value];
      const value = typeof scalar === "function" ? scalar(parent) : scalar;
      return value;
    }
    default:
      throw new Error(`Unhandled definition kind '${definition.kind}'`);
  }
};

export const proxy = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  type: string,
  ...patches: Patch<T>[]
): T => _proxy(definitions, scalars, type, undefined, patches);

const constToValue = (value: ConstValueNode): unknown => {
  switch (value.kind) {
    case Kind.INT:
      return parseInt(value.value);
    case Kind.FLOAT:
      return parseFloat(value.value);
    case Kind.STRING:
      return value.value;
    case Kind.BOOLEAN:
      return value.value;
    case Kind.NULL:
      return null;
    case Kind.ENUM:
      return value.value;
    case Kind.LIST:
      return value.values.map(constToValue);
    case Kind.OBJECT:
      return Object.fromEntries(
        value.fields.map((f) => [f.name.value, constToValue(f.value)]),
      );
    default:
      absurd(value);
  }
};

// const _operation = <D extends Record<string, unknown>, V>(
//   definitions: readonly DefinitionNode[],
//   scalars: Record<string, unknown | ((typename: string) => unknown)>,
//   query: string,
//   document: DocumentNode,
//   operation: OperationDefinitionNode,
//   prev: OperationMock<D, V> | undefined,
//   patches: Patch<{
//     data: D;
//     variables: V;
//     error: Error;
//     errors: GraphQLError[];
//   }>[],
// ): OperationMock<D, V> => {
//   if (patches.length || !prev) {
//     return null as unknown as OperationMock<D, V>;
//   }
// };

export const operation = <
  O extends {
    data: Record<string, unknown>;
    variables?: Record<string, unknown>;
    error?: Error;
    errors?: GraphQLError[];
  },
>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  query: string,
  ...patches: Patch<O>[]
): OperationMock<O["data"], O["variables"]> => {
  const document = parse(query);

  const operations = document.definitions.filter((
    d,
  ): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1) {
    throw new Error(`Expected 1 operation, got ${operations.length}`);
  }
  const operation = operations[0];
  if (!operation.name?.value) throw new Error("Expected operation to be named");

  const result = _proxy<O>(
    [...definitions, ...document.definitions],
    scalars,
    operation.name.value,
    undefined,
    patches,
  );

  const mock: OperationMock<O["data"], O["variables"]> = {
    request: { query },
    result: {},
  };

  if (result.variables) mock.request.variables = result.variables;
  if (result.error) mock.error = result.error;
  else if (result.data) mock.result.data = result.data;
  if (result.errors) mock.result.errors = result.errors;

  return mock;

  // return _operation<O["data"], O["variables"]>(
  //   definitions,
  //   scalars,
  //   query,
  //   document,
  //   operation,
  //   undefined,
  //   patches,
  // );

  // let variables: O["variables"] | null = null;
  // if (operation.variableDefinitions?.length) {
  //   const variablePatches = patches.map((p) => p.variables)
  //     .filter((v): v is Patch<O["variables"]> => !!v);
  //   variables = Object.fromEntries(
  //     operation.variableDefinitions.map((vd) => {
  //       return [
  //         vd.variable.name.value,
  //         // vd.defaultValue
  //         //   ? constToValue(vd.defaultValue, variablePatches)
  //         resolveValue(definitions, scalars, vd.type, {
  //           hostType: `${operation.name?.value ?? "<<operation>>"}Variables`,
  //           prop: vd.variable.name.value,
  //           patches: variablePatches,
  //         }),
  //       ];
  //     }),
  //   );
  // }

  // const mock: OperationMock = {
  //   request: {
  //     query,
  //   },
  //   result: {},
  // };

  // if (variables) mock.request.variables = variables;

  // return mock;
};
