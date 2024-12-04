import type {
  ConstValueNode,
  DefinitionNode,
  EnumTypeDefinitionNode,
  FragmentDefinitionNode,
  GraphQLError,
  InterfaceTypeDefinitionNode,
  NameNode,
  ObjectTypeDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from "npm:graphql";
import { Kind, Location, parse } from "npm:graphql";
import type {
  CovariantEmpty,
  OperationMock,
  Patch,
  SimpleOperationMock,
} from "./types.ts";
import { absurd } from "./util.ts";

type NamedDefinitionNode = DefinitionNode & { name: NameNode };

let getDefaultPatch = <T>(
  __typename: string,
): Patch<T> | ((prev: T) => Patch<T> | undefined) | undefined => undefined;
export const withGetDefaultPatch = <T>(
  newGetDefaultPatch: <U>(
    __typename: string,
  ) => Patch<U> | ((prev: U) => Patch<U> | undefined) | undefined,
  fn: () => T,
) => {
  const prev = getDefaultPatch;
  getDefaultPatch = newGetDefaultPatch;
  try {
    return fn();
  } finally {
    getDefaultPatch = prev;
  }
};

const builtInScalars = ["Int", "Float", "String", "Boolean", "ID"];

const resolveType = (definitions: readonly DefinitionNode[], path: string) => {
  let definition: (NamedDefinitionNode) | undefined;
  let type: TypeNode | undefined;
  let parent: string | undefined;
  let kind: "field" | "argument" = "field";
  const parts = path.split(/(\.\$|\.)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "." || parts[i] === ".$") {
      kind = parts[i] === "." ? "field" : "argument";
      i++;
      if (i === parts.length) break;
    }
    const name = parts[i];
    if (!definition) {
      definition = definitions.find((d): d is NamedDefinitionNode =>
        "name" in d && d.name?.value === name
      );
      if (!definition && builtInScalars.includes(name)) {
        definition = {
          kind: Kind.SCALAR_TYPE_DEFINITION,
          name: { kind: Kind.NAME, value: name },
        };
      }
      type = {
        kind: Kind.NON_NULL_TYPE,
        type: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: name } },
      };
    } else {
      parent = definition.name.value;

      type = undefined;
      if (kind === "field") {
        const field = "fields" in definition
          ? definition.fields?.find((f) => f.name.value === name)
          : undefined;
        if (!field) {
          throw new Error(
            `Could not find field ${name} on ${
              "name" in definition ? definition.name?.value : "<unknown>"
            }`,
          );
        }
        type = field.type;
      } else {
        const argument = "arguments" in definition
          ? definition.arguments?.find((a) => a.name.value === name)
          : "variableDefinitions" in definition
          ? definition.variableDefinitions?.find((v) =>
            v.variable.name.value === name
          )
          : undefined;
        if (!argument) {
          throw new Error(
            `Could not find argument ${name} on ${
              "name" in definition ? definition.name?.value : "<unknown>"
            }`,
          );
        }
        type = argument.type;
      }

      while (parts[i + 2]?.match(/^\d$/)) {
        if (type.kind === Kind.NON_NULL_TYPE) type = type.type;
        if (type.kind !== Kind.LIST_TYPE) throw new Error("Expected list type");
        type = type.type;
        i += 2;
      }

      let t = type;
      while (t.kind !== Kind.NAMED_TYPE) t = t.type;
      const namedType = t;
      definition = definitions.find((d): d is NamedDefinitionNode =>
        "name" in d ? d.name?.value === namedType.name.value : false
      );
      if (!definition && builtInScalars.includes(namedType.name.value)) {
        definition = {
          kind: Kind.SCALAR_TYPE_DEFINITION,
          name: { kind: Kind.NAME, value: namedType.name.value },
        };
      }
      if (!definition) {
        throw new Error(
          `Could not find type ${name}${parent ? ` on ${parent}` : ""}`,
        );
      }
    }
    if (!definition) {
      throw new Error(
        `Could not find type ${name}${parent ? ` on ${parent}` : ""}`,
      );
    }
  }
  return { parent, definition, type: type! };
};

const resolveConcreteType = <T>(
  definitions: readonly DefinitionNode[],
  definition: InterfaceTypeDefinitionNode | UnionTypeDefinitionNode,
  patch?: Patch<T>,
  prev?: T,
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
        ) ||
        ("types" in interfaceDefinition &&
          interfaceDefinition.types?.some((t) =>
            t.name.value === objectDefintion.name.value
          ))
      ) options.push(objectDefintion);
    }
    // TODO: is this a thing...?
    for (const secondOrderInterfaceDefinition of interfaceDefintions) {
      if (
        secondOrderInterfaceDefinition.interfaces?.some((i) =>
          i.name.value === interfaceDefinition.name.value
        )
      ) interfaces.push(secondOrderInterfaceDefinition);
    }
  }

  if (options.length === 1) return options[0];

  for (const field in patch) {
    options = options.filter((o) =>
      o.fields?.some((f) => f.name.value === field)
    );
    if (options.length === 1) return options[0];
  }

  if (prev && typeof prev === "object" && "__typename" in prev) {
    const match = options.find((o) => o.name.value === prev.__typename);
    if (match) return match;
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
    selectionSet?: SelectionSetNode;
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
    const base = _proxy<T[keyof T]>(
      definitions,
      scalars,
      fieldTypeDefinitions[0].name.value,
      [],
      { selectionSet: ctx.selectionSet },
    );
    const rawDefaultPatch = getDefaultPatch(type.name.value);
    const defaultPatch = typeof rawDefaultPatch === "function"
      ? rawDefaultPatch(base)
      : rawDefaultPatch;
    if (defaultPatch) {
      return _proxy<T[keyof T]>(
        definitions,
        scalars,
        fieldTypeDefinitions[0].name.value,
        [base, defaultPatch],
      );
    }
    return base;
  }

  throw new Error(
    `Unhandled default kind ${fieldTypeDefinitions.map((d) => d.kind)}`,
  );
};

const gqlprint = <T>(value: T): Partial<T> => {
  if (typeof value !== "object" || !value) return value;
  // deno-lint-ignore no-explicit-any
  if (Array.isArray(value)) return value.map(gqlprint) as any;
  const obj: Partial<T> = {};
  for (const field in value) {
    if (field === "loc" && value[field as keyof T] instanceof Location) {
      continue;
    }
    // deno-lint-ignore no-explicit-any
    obj[field as keyof T] = gqlprint(value[field]) as any;
  }
  return obj;
};

const getSelectionField = (
  definitions: readonly DefinitionNode[],
  selectionSet: SelectionSetNode,
  selection: string,
  typename?: string,
) => {
  for (const s of selectionSet.selections) {
    switch (s.kind) {
      case Kind.FIELD:
        if ((s.alias?.value ?? s.name.value) === selection) return s;
        break;
      case Kind.FRAGMENT_SPREAD: {
        const definition = definitions.find((d): d is FragmentDefinitionNode =>
          "name" in d && d.name?.value === s.name.value &&
          d.kind === Kind.FRAGMENT_DEFINITION
        );
        if (!definition) {
          throw new Error(`Could not find fragment ${s.name.value}`);
        }
        return getSelectionField(
          definitions,
          definition.selectionSet,
          selection,
          typename,
        );
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !s.typeCondition || !typename ||
          s.typeCondition.name.value === typename
        ) {
          return getSelectionField(
            definitions,
            s.selectionSet,
            selection,
            typename,
          );
        }
      }
    }
  }
};

const getSelectionSetSelection = (
  definitions: readonly DefinitionNode[],
  selectionSet: SelectionSetNode,
  selection: string,
  typename?: string,
) => {
  for (const s of selectionSet.selections) {
    switch (s.kind) {
      case Kind.FIELD:
        if ((s.alias?.value ?? s.name.value) === selection) {
          return s.selectionSet;
        }
        break;
      case Kind.FRAGMENT_SPREAD: {
        const definition = definitions.find((d): d is FragmentDefinitionNode =>
          "name" in d && d.name?.value === s.name.value &&
          d.kind === Kind.FRAGMENT_DEFINITION
        );
        if (!definition) {
          throw new Error(`Could not find fragment ${s.name.value}`);
        }
        return getSelectionSetSelection(
          definitions,
          definition.selectionSet,
          selection,
          typename,
        );
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !s.typeCondition || !typename ||
          s.typeCondition.name.value === typename
        ) {
          return getSelectionSetSelection(
            definitions,
            s.selectionSet,
            selection,
            typename,
          );
        }
      }
    }
  }
};

const selectionSetToKeys = (
  definitions: readonly DefinitionNode[],
  selectionSet: SelectionSetNode,
  typename: string,
) => {
  const keys: string[] = [];
  for (const s of selectionSet.selections) {
    switch (s.kind) {
      case Kind.FIELD:
        keys.push(s.alias?.value ?? s.name.value);
        break;
      case Kind.FRAGMENT_SPREAD: {
        const definition = definitions.find((d): d is FragmentDefinitionNode =>
          "name" in d && d.name?.value === s.name.value &&
          d.kind === Kind.FRAGMENT_DEFINITION
        );
        if (!definition) {
          throw new Error(`Could not find fragment ${s.name.value}`);
        }
        keys.push(
          ...selectionSetToKeys(definitions, definition.selectionSet, typename),
        );
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !s.typeCondition || !typename ||
          s.typeCondition.name.value === typename
        ) {
          keys.push(
            ...selectionSetToKeys(definitions, s.selectionSet, typename),
          );
        }
      }
    }
  }
  return keys;
};

const _proxy = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  path: string,
  patches: readonly (Patch<T> | ((prev: T) => Patch<T>))[],
  {
    prev,
    resolvedType = resolveType(definitions, path),
    selectionSet,
  }: {
    prev?: T;
    /** Used to handle lists */
    resolvedType?: ReturnType<typeof resolveType>;
    selectionSet?: SelectionSetNode;
  } = {},
): T => {
  const { parent = path, definition } = resolvedType;
  let type = resolvedType.type;

  if (!prev && patches.length) {
    prev = _proxy(definitions, scalars, path, patches.slice(0, -1), {
      selectionSet,
    });
  }

  const rawPatch = patches.length > 0 ? patches[patches.length - 1] : undefined;
  const patch = typeof rawPatch === "function"
    ? prev ? rawPatch(prev) : undefined
    : rawPatch;

  if (type.kind !== Kind.NON_NULL_TYPE) {
    if (!patches.length) return (prev ?? null) as T;
  } else type = type.type;

  if (type.kind === Kind.LIST_TYPE) {
    if (!patches.length) return (prev ?? []) as T;

    const value = (patches.at(-1) ?? []) as Array<unknown>;
    const previousArray = (prev ?? []) as Array<unknown>;

    const lastIndex = Math.max(previousArray.length - 1, 0);
    const nextIndex = previousArray.length;
    const length = typeof value.length === "number" ? value.length : Math.max(
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
        `${path}.${i}`,
        [
          value[i],
          i === lastIndex ? (value as { last?: number }).last : undefined,
          i === nextIndex ? (value as { next?: number }).next : undefined,
        ].filter((v) => v != null),
        {
          prev: previousArray[i],
          resolvedType: { ...resolvedType, type: type.type },
          selectionSet,
        },
      );
    }

    return arr as T;
  }

  if (!definition) throw new Error(`Could not find definition '${path}'`);

  switch (definition.kind) {
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_DEFINITION: {
      const getProp = (target: Partial<T>, prop: string | symbol) => {
        if (prop === "toJSON") return;
        if (prop === "__typename") return definition.name.value;
        if (prop in target || typeof prop === "symbol") {
          return target[prop as keyof T];
        }

        const selectionField = selectionSet && typeof prop === "string"
          ? getSelectionField(
            definitions,
            selectionSet,
            prop,
          )
          : undefined;
        const unaliased = selectionField ? selectionField.name.value : prop;

        const field = definition.fields?.find((f) =>
          f.name.value === unaliased
        );
        if (!field) return target[prop as keyof T];

        // Get from patch
        if (patches.length > 0 && patch && prop in patch) {
          const rawValue = patch[prop as keyof Patch<T>];
          const value = typeof rawValue === "function"
            ? rawValue(prev)
            : rawValue;

          if (value && typeof value === "object") {
            const nonNullFieldType = field.type.kind === Kind.NON_NULL_TYPE
              ? field.type.type
              : field.type;

            if (nonNullFieldType.kind === Kind.LIST_TYPE) {
              return target[prop as keyof T] = _proxy(
                definitions,
                scalars,
                `${path}.${prop}`,
                [value],
                {
                  prev: prev?.[prop as keyof T],
                  selectionSet: selectionSet
                    ? getSelectionSetSelection(definitions, selectionSet, prop)
                    : undefined,
                },
              );
            }

            type Child = T[keyof T];
            const childPatches: Patch<Child>[] = patches.map((p) =>
              p[prop as keyof typeof p] as Patch<Child> | undefined
            ).filter((v): v is Patch<Child> => !!v && typeof v === "object");
            return target[prop as keyof T] = _proxy<Child>(
              definitions,
              scalars,
              `${path}.${prop}`,
              childPatches,
              {
                prev: prev?.[prop as keyof T],
                selectionSet: selectionSet
                  ? getSelectionSetSelection(definitions, selectionSet, prop)
                  : undefined,
              },
            );
          }

          if (value !== undefined) {
            return target[prop as keyof T] = value as T[keyof T];
          }
        }

        // Get from prev proxy if available; we check if prop in prev for
        // typename changes due to interfaces (we don't predict typename ahead
        // of time, since that's tedious...; could maybe use a custom Array that
        // keeps a reference to the full array after slices)
        if (prev && prop in (prev as Record<string, unknown>)) {
          return target[prop as keyof T] = prev[prop as keyof T];
        }

        // Otherwise generate it from type
        return target[prop as keyof T] = resolveValue(
          definitions,
          scalars,
          field.type,
          {
            hostType: definition.name.value,
            prop,
            selectionSet: selectionSet
              ? getSelectionSetSelection(definitions, selectionSet, prop)
              : undefined,
          },
        ) as T[keyof T];
      };

      const keys: string[] = [
        ...(definition.kind === Kind.OBJECT_TYPE_DEFINITION
          ? ["__typename"]
          : []),
        ...(selectionSet
          ? selectionSetToKeys(
            definitions,
            selectionSet,
            definition.name.value,
          )
          : definition.fields?.map((f) => f.name.value) ?? []),
      ];

      return new Proxy({}, {
        get: getProp,
        set: (target, prop, value) => {
          target[prop as keyof T] = value;
          return true;
        },
        ownKeys: () => keys,
        has: (target, prop) =>
          typeof prop === "string" ? keys.includes(prop) : prop in target,
        getOwnPropertyDescriptor: (target, prop) =>
          prop === "__typename" ||
            (typeof prop === "string" ? keys.includes(prop) : false)
            ? ({
              enumerable: true,
              configurable: true,
              writable: false,
              value: getProp(target, prop),
            })
            : Object.getOwnPropertyDescriptor(target, prop),
      }) as T;
    }
    case Kind.UNION_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_DEFINITION: {
      // When creating prev, we need hint the desired type...
      const concreteType = resolveConcreteType(
        definitions,
        definition,
        patch,
        prev,
      );
      return _proxy(definitions, scalars, concreteType.name.value, patches, {
        prev,
        selectionSet,
      });
    }
    case Kind.OPERATION_DEFINITION: {
      type Mock = {
        variables?: Record<string, unknown>;
        data: Record<string, unknown> | null;
        error?: Error;
        errors?: GraphQLError[];
      };

      const mockPrev = prev as Mock | undefined;
      const { variables: _1, data: _2, error: _3, errors: _4, ...prevExtra } =
        mockPrev ?? {};
      const mockPatch = patch as Patch<Mock> | undefined;
      const { variables: _5, data: _6, error: _7, errors: _8, ...patchExtra } =
        mockPatch ?? {};

      const mock: Mock = { ...prevExtra, ...patchExtra, data: null };
      // const patch = patches[patches.length - 1] as Patch<Mock> | undefined;

      const variablePatch = typeof mockPatch?.variables === "function"
        ? mockPatch.variables(mockPrev!)
        : mockPatch?.variables;
      for (const variableDefinition of definition.variableDefinitions ?? []) {
        const name = variableDefinition.variable.name.value;

        if (patch) {
          if (variablePatch && name in variablePatch) {
            const rawValue = variablePatch[name];
            const value = typeof rawValue === "function"
              ? rawValue(mockPrev!.variables)
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
                `${path}.$${name}`,
                [value],
                {
                  prev: mockPrev?.variables?.[name],
                  resolvedType: {
                    parent: `${path}Variables`,
                    type: variableDefinition.type,
                    definition: resolveType(
                      definitions,
                      namedVariableType.name.value,
                    ).definition,
                  },
                },
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

        if (mockPrev?.variables && name in mockPrev.variables) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = mockPrev.variables[name];
          continue;
        }

        const result = resolveValue(
          definitions,
          scalars,
          variableDefinition.type,
          { hostType: `${path}Variables`, prop: name },
        );
        if (result != null) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = result;
        }
      }

      const dataPatch = typeof mockPatch?.data === "function"
        ? mockPatch.data(mockPrev!)
        : mockPatch?.data;
      for (const selection of definition.selectionSet.selections ?? []) {
        switch (selection.kind) {
          case Kind.FIELD: {
            const prop = selection.alias?.value ?? selection.name.value;
            const rawValue = dataPatch?.[prop];
            const value = typeof rawValue === "function"
              ? rawValue(mockPrev?.data)
              : rawValue;
            if (!mock.data) mock.data = {};
            // Query, Mutation, Subscription
            const operationKey = definition.operation[0].toUpperCase() +
              definition.operation.slice(1);

            mock.data[prop] = _proxy(
              definitions,
              scalars,
              `${operationKey}.${selection.name.value}`,
              value != null ? [value] : [],
              {
                prev: mockPrev?.data?.[prop],
                selectionSet: selection.selectionSet,
              },
            );

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
            ? patch.error(mockPrev!)
            : patch.error;
          // TODO: what if an actual error patch is passed?
          mock.error = value as Error;
        }

        if ("errors" in patch) {
          const rawErrors = typeof patch.errors === "function"
            ? patch.errors(mockPrev!)
            : patch.errors;
          if (Array.isArray(rawErrors) && rawErrors.length) {
            mock.errors = rawErrors as GraphQLError[];
          }
        }
      }

      return mock as T;
    }
    case Kind.SCALAR_TYPE_DEFINITION: {
      const patch = patches[patches.length - 1];
      if (patch != null) return patch as T;
      if (prev != null) return prev;

      if (!(definition.name.value in scalars)) {
        throw new Error(
          `Missing scalar ${definition.name.value}`,
        );
      }
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
  ...patches: (Patch<T> | ((prev: T) => Patch<T>))[]
): T => _proxy(definitions, scalars, type, patches);

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

export const operation = <
  O extends SimpleOperationMock,
  Extra = CovariantEmpty,
>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  query: string,
  ...patches: (Patch<Omit<O, "error" | "errors">> & {
    error?: Error;
    errors?: GraphQLError[];
  } & Partial<Extra>)[]
): OperationMock<O["data"], O["variables"]> & Partial<Extra> => {
  const document = parse(query);

  const operations = document.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (operations.length !== 1) {
    throw new Error(`Expected 1 operation, got ${operations.length}`);
  }
  const operation = operations[0];
  if (!operation.name?.value) throw new Error("Expected operation to be named");

  const { variables, data, error, errors, ...extra } = _proxy<O>(
    [...definitions, ...document.definitions],
    scalars,
    operation.name.value,
    patches as Patch<O>[], // Ignore error/errors, they're not patches
  );

  const mock: OperationMock<O["data"], O["variables"]> & Partial<Extra> = {
    request: { query: document },
    result: {},
    ...extra as Extra,
  };

  if (variables) mock.request.variables = variables;
  if (error) {
    mock.error = error instanceof Error
      ? error
      : Object.assign(new Error(), error);
  } else if (data) mock.result.data = data;
  if (errors) mock.result.errors = errors;

  return mock;
};
