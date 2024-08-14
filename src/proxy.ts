import {
  DefinitionNode,
  EnumTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  Kind,
  ObjectTypeDefinitionNode,
} from "npm:graphql";
import { Patch } from "./types.ts";

const resolveType = (definitions: readonly DefinitionNode[], type: string) => {
  const path = type.split(".");
  let definition: DefinitionNode | undefined;
  let parent: DefinitionNode | undefined;
  for (const name of path) {
    if (!definition) {
      definition = definitions.find((d) =>
        "name" in d && d.name?.value === name
      );
    } else {
      parent = definition;
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
      definition = definitions.find((d) =>
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
        `Could not find type ${name}${
          parent ? ` on ${"name" in parent ? parent.name?.value : ""}` : ""
        }`,
      );
    }
  }
  return definition;
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

const _proxy = <T>(
  definitions: readonly DefinitionNode[],
  type: string,
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  prev: T | undefined,
  patches: Patch<T>[],
): T => {
  const definition = resolveType(definitions, type);
  if (!definition) throw new Error(`Could not find definition '${name}'`);

  switch (definition.kind) {
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_DEFINITION: {
      if (!prev) {
        prev = patches.length
          ? _proxy(definitions, type, scalars, undefined, patches.slice(0, -1))
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
                    `${type}.${prop}`,
                    scalars,
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
                    `${type}.${prop}`,
                    scalars,
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
              `${type}.${prop}`,
              scalars,
              undefined,
              childPatches,
            );
          }

          if (value == null) {
            if (field.type.kind !== Kind.NON_NULL_TYPE) {
              return target[prop as keyof T] = null as T[keyof T];
            }
          } else return target[prop as keyof T] = value as T[keyof T];
        }

        // Get from prev proxy if available
        if (prev) return target[prop as keyof T] = prev[prop as keyof T];

        // Otherwise generate it from type

        if (field.type.kind !== Kind.NON_NULL_TYPE) {
          return target[prop as keyof T] = null as T[keyof T];
        }
        if (field.type.type.kind === Kind.LIST_TYPE) {
          return target[prop as keyof T] = [] as T[keyof T];
        }
        const fieldType = field.type.type;
        const fieldTypeDefinitions = definitions.filter((d) =>
          "name" in d &&
          d.name?.value === fieldType.name.value
        );

        if (
          fieldTypeDefinitions.length &&
          fieldTypeDefinitions.every((d) =>
            d.kind === Kind.ENUM_TYPE_DEFINITION
          )
        ) {
          return target[prop as keyof T] = fieldTypeDefinitions.find((
            d,
          ): d is EnumTypeDefinitionNode =>
            d.kind === Kind.ENUM_TYPE_DEFINITION &&
            (d.values?.length ?? 0) > 0
          )?.values?.[0].name.value as T[keyof T];
        }

        if (
          fieldTypeDefinitions.every((d) =>
            d.kind === Kind.SCALAR_TYPE_DEFINITION
          )
        ) {
          if (!(fieldType.name.value in scalars)) {
            throw new Error(
              `Missing scalar ${fieldType.name.value}`,
            );
          }
          const scalar = scalars[fieldType.name.value];
          const value = typeof scalar === "function"
            ? scalar(definition.name.value)
            : scalar;
          return target[prop as keyof T] = value as T[keyof T];
        }

        if (
          fieldTypeDefinitions.length === 1 &&
          (fieldTypeDefinitions[0].kind === Kind.OBJECT_TYPE_DEFINITION ||
            fieldTypeDefinitions[0].kind === Kind.INTERFACE_TYPE_DEFINITION ||
            fieldTypeDefinitions[0].kind === Kind.INPUT_OBJECT_TYPE_DEFINITION)
        ) {
          const childPatches = patches.map((p) => p[prop as keyof typeof p])
            .filter((v) => !!v && typeof v === "object") as Patch<T[keyof T]>[];
          return target[prop as keyof T] = _proxy<T[keyof T]>(
            definitions,
            `${type}.${prop}`,
            scalars,
            undefined,
            childPatches,
          );
        }

        throw new Error(
          `Unhandled default kind ${fieldTypeDefinitions.map((d) => d.kind)}`,
        );
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
        concreteType.name.value,
        scalars,
        undefined,
        patches,
      );
    }
    default:
      throw new Error(`Unhandled definition kind '${definition.kind}'`);
  }
};

export const proxy = <T>(
  definitions: readonly DefinitionNode[],
  type: string,
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  ...patches: Patch<T>[]
): T => _proxy(definitions, type, scalars, undefined, patches);
