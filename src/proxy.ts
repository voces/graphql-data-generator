import type {
  ConstValueNode,
  DefinitionNode,
  DocumentNode,
  EnumTypeDefinitionNode,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLError,
  InputObjectTypeDefinitionNode,
  InputObjectTypeExtensionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  NameNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationDefinitionNode,
  SelectionSetNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from "npm:graphql";
import { Kind, parse } from "npm:graphql";
import type {
  CovariantEmpty,
  OperationMock,
  Patch,
  SimpleOperationMock,
} from "./types.ts";
import { absurd } from "./util.ts";

/**
 * Updates the value to the base value, bypassing default transformations.
 * Useful to clear optional inputs, resulting in `undefined` rather than `null`.
 */
export const clear = Symbol("clear") as unknown as undefined;

type NamedDefinitionNode = DefinitionNode & { name: NameNode };

/**
 * Called to insert default patches at the front of nested objects (props &
 * arrays). `build` will insert default patches for top-level objects.
 */
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

const resolveType = (
  definitions: readonly DefinitionNode[],
  path: string,
) => {
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
      // Check if this is a fragment type
      if (!definition) {
        const fragment = definitions.find((d): d is FragmentDefinitionNode =>
          d.kind === Kind.FRAGMENT_DEFINITION && d.name.value === name
        );
        if (fragment) {
          // Use the fragment definition directly
          definition = fragment;
          type = {
            kind: Kind.NON_NULL_TYPE,
            type: {
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: name },
            },
          };
        }
      }
      if (!type) {
        type = {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.NAMED_TYPE,
            name: { kind: Kind.NAME, value: name },
          },
        };
      }
    } else {
      parent = definition.name.value;

      type = undefined;
      if (kind === "field") {
        const field = "fields" in definition
          ? getField(definitions, definition, name)
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

      while (parts[i + 2]?.match(/^\d+$/)) {
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
  selectionSet?: SelectionSetNode,
) => {
  const objectDefinitions = definitions.filter((
    d,
  ): d is ObjectTypeDefinitionNode => d.kind === Kind.OBJECT_TYPE_DEFINITION);
  const interfaceDefinitions = definitions.filter((
    d,
  ): d is InterfaceTypeDefinitionNode =>
    d.kind === Kind.INTERFACE_TYPE_DEFINITION
  );

  let options: ObjectTypeDefinitionNode[] = [];
  const interfaces = [definition];
  while (interfaces.length) {
    const interfaceDefinition = interfaces.pop()!;
    for (const objectDefinition of objectDefinitions) {
      if (
        objectDefinition.interfaces?.some((i) =>
          i.name.value === interfaceDefinition.name.value
        ) ||
        ("types" in interfaceDefinition &&
          interfaceDefinition.types?.some((t) =>
            t.name.value === objectDefinition.name.value
          ))
      ) options.push(objectDefinition);
    }
    // TODO: is this a thing...?
    for (const secondOrderInterfaceDefinition of interfaceDefinitions) {
      if (
        secondOrderInterfaceDefinition.interfaces?.some((i) =>
          i.name.value === interfaceDefinition.name.value
        )
      ) interfaces.push(secondOrderInterfaceDefinition);
    }
  }

  if (options.length === 1) return options[0];

  for (const alias in patch) {
    const field = selectionSet
      ? getSelectionField(definitions, selectionSet, alias)?.name.value ?? alias
      : alias;
    options = options.filter((o) =>
      field === "__typename"
        ? o.name.value === patch[alias]
        : o.fields?.some((f) => f.name.value === field) ||
          (definition.kind === Kind.INTERFACE_TYPE_DEFINITION &&
            definition.fields?.some((f) => f.name.value === field))
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

  // Check for default patch on the union/interface type itself
  const unionDefault = getDefaultPatch<Record<string, unknown>>(
    definition.name.value,
  );
  if (unionDefault && typeof unionDefault === "object") {
    let defaultOptions = [...options];
    for (const field in unionDefault) {
      defaultOptions = defaultOptions.filter((o) =>
        field === "__typename"
          ? o.name.value === unionDefault[field]
          : o.fields?.some((f) => f.name.value === field) ||
            (definition.kind === Kind.INTERFACE_TYPE_DEFINITION &&
              definition.fields?.some((f) => f.name.value === field))
      );
      if (defaultOptions.length === 1) return defaultOptions[0];
    }
    if (defaultOptions.length > 0 && defaultOptions.length < options.length) {
      return defaultOptions[0];
    }
  }

  return options[0];
};

const resolveValue = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  type: TypeNode,
  ctx: {
    hostType: string;
    path?: string;
    prop: string;
    input: boolean;
    selectionSet?: SelectionSetNode;
  },
) => {
  if (type.kind !== Kind.NON_NULL_TYPE) return ctx.input ? undefined : null;
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
    fieldTypeDefinitions.length === 1 && "name" in fieldTypeDefinitions[0] &&
    fieldTypeDefinitions[0].name
  ) {
    return _proxy<T[keyof T]>(
      definitions,
      scalars,
      ctx.path ? `${ctx.path}.${ctx.prop}` : fieldTypeDefinitions[0].name.value,
      [],
      { selectionSet: ctx.selectionSet, nonNull: true },
    );
  }

  throw new Error(
    `Unhandled default kind ${fieldTypeDefinitions.map((d) => d.kind)}`,
  );
};

const getSelectionField = (
  definitions: readonly DefinitionNode[],
  selectionSet: SelectionSetNode,
  selection: string,
  typename?: string,
): FieldNode | undefined => {
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
          const value = getSelectionField(
            definitions,
            s.selectionSet,
            selection,
            typename,
          );
          if (value) return value;
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
): SelectionSetNode | undefined => {
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
          const value = getSelectionSetSelection(
            definitions,
            s.selectionSet,
            selection,
            typename,
          );
          if (value) return value;
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
  const keys = new Set<string>();
  for (const s of selectionSet.selections) {
    switch (s.kind) {
      case Kind.FIELD:
        keys.add(s.alias?.value ?? s.name.value);
        break;
      case Kind.FRAGMENT_SPREAD: {
        const definition = definitions.find((d): d is FragmentDefinitionNode =>
          "name" in d && d.name?.value === s.name.value &&
          d.kind === Kind.FRAGMENT_DEFINITION
        );
        if (!definition) {
          throw new Error(`Could not find fragment ${s.name.value}`);
        }
        for (
          const key of selectionSetToKeys(
            definitions,
            definition.selectionSet,
            typename,
          )
        ) keys.add(key);
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !s.typeCondition || !typename ||
          s.typeCondition.name.value === typename
        ) {
          for (
            const key of selectionSetToKeys(
              definitions,
              s.selectionSet,
              typename,
            )
          ) keys.add(key);
        }
      }
    }
  }
  return Array.from(keys);
};

const getField = (
  definitions: readonly DefinitionNode[],
  definition:
    | InputObjectTypeDefinitionNode
    | InputObjectTypeExtensionNode
    | InterfaceTypeDefinitionNode
    | InterfaceTypeExtensionNode
    | ObjectTypeDefinitionNode
    | ObjectTypeExtensionNode,
  name: string,
) => {
  const field = definition.fields?.find((f) => f.name.value === name);
  if (field) return field;
  if (
    !("interfaces" in definition) ||
    !definition.interfaces?.length
  ) return;
  for (const interfaceName of definition.interfaces) {
    const interfaceDefinition = definitions.find((
      d,
    ): d is InterfaceTypeDefinitionNode =>
      d.kind === Kind.INTERFACE_TYPE_DEFINITION &&
      d.name.value === interfaceName.name.value
    );
    if (!interfaceDefinition) continue;
    const field = interfaceDefinition.fields?.find((f) =>
      f.name.value === name
    );
    if (field) return field;
  }
};

export const _proxy = <T>(
  definitions: readonly DefinitionNode[],
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  path: string,
  patches: readonly (Patch<T> | ((prev: T) => Patch<T> | undefined))[],
  {
    prev,
    resolvedType = resolveType(definitions, path),
    selectionSet,
    nonNull,
  }: {
    prev?: T;
    /** Used to handle lists */
    resolvedType?: ReturnType<typeof resolveType>;
    selectionSet?: SelectionSetNode;
    nonNull?: boolean;
  } = {},
): T => {
  const { parent = path, definition } = resolvedType;
  let type = resolvedType.type;

  if (!prev) {
    if (nonNull) {
      const typeName = type.kind === Kind.NAMED_TYPE
        ? type.name.value
        : type.kind === Kind.NON_NULL_TYPE && type.type.kind === Kind.NAMED_TYPE
        ? type.type.name.value
        : undefined;
      if (typeName) {
        const rawDefaultPatch = getDefaultPatch<T>(typeName);
        if (rawDefaultPatch) patches = [rawDefaultPatch, ...patches];
      }
    }

    if (patches.length) {
      prev = _proxy(definitions, scalars, path, patches.slice(0, -1), {
        selectionSet,
      });
    }
  }

  const rawPatch = patches.length > 0 ? patches[patches.length - 1] : undefined;
  const patch = typeof rawPatch === "function"
    ? prev ? rawPatch(prev) : undefined
    : rawPatch;
  if (patch === clear) {
    return _proxy(definitions, scalars, path, [], { selectionSet });
  }

  if (type.kind !== Kind.NON_NULL_TYPE) {
    if (!patches.length && !nonNull) {
      return (prev ??
        (resolveType(definitions, path.split(".").slice(0, -1).join("."))
            .definition?.kind ===
            Kind.INPUT_OBJECT_TYPE_DEFINITION
          ? undefined
          : null)) as T;
    }
    if (patches.at(-1) === null) return null as T;
  } else type = type.type;

  if (type.kind === Kind.LIST_TYPE) {
    if (!patches.length) return (prev ?? []) as T;

    const value = (patches.at(-1) ?? []) as Array<unknown>;
    if (value === clear) {
      return _proxy(definitions, scalars, path, [], { selectionSet });
    }
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
      const nestType = type.type.kind === Kind.NAMED_TYPE
        ? type.type.name.value
        : type.type.kind === Kind.NON_NULL_TYPE &&
            type.type.type.kind === Kind.NAMED_TYPE
        ? type.type.type.name.value
        : undefined;
      arr[i] = _proxy(
        definitions,
        scalars,
        `${path}.${i}`,
        [
          // TODO: should be handled in _proxy
          nestType && !previousArray[i] ? getDefaultPatch(nestType) : undefined,
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

        const field = getField(definitions, definition, unaliased);
        if (!field) return target[prop as keyof T];

        // Get from patch
        if (patches.length > 0 && patch && prop in patch) {
          const rawValue = patch[prop as keyof Patch<T>];
          const value = typeof rawValue === "function"
            ? rawValue(prev)
            : rawValue;

          if (value === clear) {
            return target[prop as keyof T] = _proxy(
              definitions,
              scalars,
              `${path}.${unaliased}`,
              [],
              { selectionSet },
            );
          }

          if (value && typeof value === "object") {
            const nonNullFieldType = field.type.kind === Kind.NON_NULL_TYPE
              ? field.type.type
              : field.type;

            if (nonNullFieldType.kind === Kind.LIST_TYPE) {
              return target[prop as keyof T] = _proxy(
                definitions,
                scalars,
                `${path}.${unaliased}`,
                [value],
                {
                  prev: prev?.[prop as keyof T],
                  selectionSet: selectionSet
                    ? getSelectionSetSelection(
                      definitions,
                      selectionSet,
                      unaliased,
                    )
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
              `${path}.${unaliased}`,
              childPatches,
              {
                prev: prev?.[prop as keyof T],
                selectionSet: selectionSet
                  ? getSelectionSetSelection(
                    definitions,
                    selectionSet,
                    unaliased,
                  )
                  : undefined,
                nonNull: true,
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
            path,
            prop: unaliased,
            selectionSet: selectionSet
              ? getSelectionSetSelection(definitions, selectionSet, prop)
              : undefined,
            input: definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION,
          },
        ) as T[keyof T];
      };

      const keys = selectionSet
        ? selectionSetToKeys(
          definitions,
          selectionSet,
          definition.name.value,
        )
        : definition.fields?.map((f) => f.name.value) ?? [];
      if (
        definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
        !keys.includes("__typename")
      ) keys.unshift("__typename");

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
        selectionSet,
      );
      return _proxy(definitions, scalars, concreteType.name.value, patches, {
        prev,
        selectionSet,
        nonNull: true,
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
      const { variables: _1, data: _2, ...prevExtra } = mockPrev ?? {};
      const mockPatch = patch as Patch<Mock> | undefined;
      const { variables: _3, data: _4, error: _5, errors: _6, ...patchExtra } =
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

              if (value !== clear) {
                mock.variables[name] = value;
                continue;
              }

              const isNonNull =
                variableDefinition.type.kind === Kind.NON_NULL_TYPE;

              // Use default value if available if specified
              if (variableDefinition.defaultValue) {
                mock.variables[name] = constToValue(
                  variableDefinition.defaultValue,
                );
                continue;
              }

              // For nullable variables, clear means undefined
              if (!isNonNull) {
                delete mock.variables[name];
                continue;
              }

              // Generate a default value based on the type
              const result = resolveValue(
                definitions,
                scalars,
                variableDefinition.type,
                { hostType: `${path}Variables`, prop: name, input: false },
              );
              mock.variables[name] = result;
              continue;
            }
          }
        }

        if (mockPrev?.variables && name in mockPrev.variables) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = mockPrev.variables[name];
          continue;
        }

        if (variableDefinition.defaultValue) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = constToValue(
            variableDefinition.defaultValue,
          );
          continue;
        }

        const result = resolveValue(
          definitions,
          scalars,
          variableDefinition.type,
          { hostType: `${path}Variables`, prop: name, input: false },
        );
        if (result != null) {
          if (!mock.variables) mock.variables = {};
          mock.variables[name] = result;
        }
      }

      const dataPatch = typeof mockPatch?.data === "function"
        ? mockPatch.data(mockPrev!)
        : mockPatch?.data;
      // Allow explicitly setting data to null (e.g., for error responses)
      if (dataPatch !== null) {
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

              if (value === clear) {
                mock.data[prop] = _proxy(
                  definitions,
                  scalars,
                  `${operationKey}.${selection.name.value}`,
                  [],
                  { selectionSet: selection.selectionSet },
                );
                continue;
              }

              mock.data[prop] = _proxy(
                definitions,
                scalars,
                `${operationKey}.${selection.name.value}`,
                value !== undefined ? [value] : [],
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
    case Kind.ENUM_TYPE_DEFINITION: {
      const patch = patches[patches.length - 1];
      if (patch != null) return patch as T;
      if (prev != null) return prev;

      return definition.values?.[0]?.name.value as T;
    }
    case Kind.FRAGMENT_DEFINITION: {
      // For fragments, create a proxy for the base type with the fragment's selection set
      const baseTypeName = definition.typeCondition.name.value;
      return _proxy<T>(
        definitions,
        scalars,
        baseTypeName,
        patches,
        {
          prev,
          selectionSet: definition.selectionSet,
          nonNull: true,
        },
      );
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
  query: string | DocumentNode,
  ...patches: (Patch<Omit<O, "error" | "errors" | "data">> & {
    data?: Patch<O["data"]> | null;
    error?: Error;
    errors?: GraphQLError[];
  } & Partial<Extra>)[]
): OperationMock<O["data"], O["variables"]> & Partial<Extra> => {
  const document = typeof query === "string" ? parse(query) : query;

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
  } else if (data !== undefined && data !== null) mock.result.data = data;
  if (errors) mock.result.errors = errors;

  return mock;
};
