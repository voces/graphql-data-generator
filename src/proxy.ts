// export const objectProxy = () => {

import { DefinitionNode, EnumTypeDefinitionNode, Kind } from "npm:graphql";
import { Patch } from "./types.ts";

const mergePatch = <T>(
  definitions: readonly DefinitionNode[],
  definition: DefinitionNode,
  ...patches: Patch<T>[]
): Patch<T> => {
  switch (definition.kind) {
    case Kind.OBJECT_TYPE_DEFINITION: {
      const obj = {} as Patch<T>;
      return obj;
    }
    default:
      throw new Error(`Unhandled definition kind '${definition.kind}'`);
  }
};

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

const _proxy = <T>(
  definitions: readonly DefinitionNode[],
  type: string,
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  ...patches: Patch<T>[]
): T => {
  const definition = resolveType(definitions, type);

  if (!definition) throw new Error(`Could not find definition '${name}'`);

  switch (definition.kind) {
    case Kind.OBJECT_TYPE_DEFINITION: {
      const getProp = (target: Partial<T>, prop: string | symbol) => {
        if (prop === "toJSON") return;
        if (prop === "__typename") return definition.name.value;
        if (prop in target) return target[prop as keyof T];
        if (typeof prop === "symbol") return target[prop as keyof T];

        for (let i = patches.length - 1; i >= 0; i--) {
          if (!(prop in patches[i])) continue;

          const rawValue = patches[i][prop as keyof Patch<T>];
          const value = typeof rawValue === "function" ? rawValue(p) : rawValue;

          if (value && typeof value === "object") {
            type Child = T[keyof T];
            const childPatches: Patch<Child>[] = patches.map((
              p,
            ) =>
              p[prop as keyof typeof p] as
                | Patch<Child>
                | undefined
            )
              // deno-lint-ignore no-explicit-any
              .filter((v: any): v is Patch<Child> =>
                v && typeof v === "object"
              );
            return target[prop as keyof T] = _proxy<Child>(
              definitions,
              `${type}.${prop}`,
              scalars,
              ...childPatches,
            );
          }

          return target[prop as keyof T] = value as T[keyof T];
        }

        const field = definition.fields?.find((f) => f.name.value === prop);
        if (!field) {
          throw new Error(
            `Could not find field ${prop} in ${name}`,
          );
        }
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
          // Incldues fieldTypeDefinitions.length === 0
          fieldTypeDefinitions.every((d) =>
            d.kind === Kind.SCALAR_TYPE_DEFINITION
          )
        ) {
          if (!(fieldType.name.value in scalars)) {
            console.log(fieldType.name.value);
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
          fieldTypeDefinitions[0].kind === Kind.OBJECT_TYPE_DEFINITION
        ) {
          return target[prop as keyof T] = proxy(
            definitions,
            `${type}.${prop}`,
            scalars,
            //@ts-ignore Zz
            ...patches.map((p) => p[prop as keyof typeof p])
              .filter((v) => v && typeof v === "object"),
          );
        }

        throw new Error(
          `Unhandled default kind ${fieldTypeDefinitions.map((d) => d.kind)}`,
        );
      };

      const p = new Proxy({}, {
        get: getProp,
        ownKeys: () => [
          "__typename",
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

      return p;
    }
    default:
      throw new Error(`Unhandled definition kind '${definition.kind}'`);
  }
};

// const serialize = <T>(
//   proxyObject: T,
//   definitions: readonly DefinitionNode[],
//   type: string,
// ) => {
//   // No need to serialize primitives
//   if (typeof proxyObject !== "object" || !proxyObject) return proxyObject;

//   const definition = resolveType(definitions, type);
//   if (!definition) throw new Error(`Could not find definition '${name}'`);

//   // Not an object (TODO: arrays?)
//   if (!("fields" in definition)) return proxyObject;

//   const obj = {} as T;
//   for (const field of definition.fields ?? []) {
//     console.log("reading", field.name.value);
//     obj[field.name.value as keyof T] = proxyObject[field.name.value as keyof T];
//   }

//   // if ("interfaces" in definition) definition.interfaces;

//   // console.log(definition.fields?.map((f) => f.name.value));
//   return obj;
// };

export const proxy = <T>(
  definitions: readonly DefinitionNode[],
  type: string,
  scalars: Record<string, unknown | ((typename: string) => unknown)>,
  ...patches: Patch<T>[]
): T =>
  // serialize(
  _proxy(definitions, type, scalars, ...patches);
//   definitions,
//   type,
// );
