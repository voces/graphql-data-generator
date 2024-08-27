import { parse } from "npm:graphql";

// If a collision is detected:
// - Operations will be prefixed with their operation: queryFoo or mutateFoo

import {
  Build,
  EmptyObject,
  MapObjectsToTransforms,
  MapOperationsToTransforms,
} from "./_types.ts";
import { OperationMock, Patch, Shift } from "./types.ts";
import { operation, proxy, withGetDefaultPatch } from "./proxy.ts";
import { toObject } from "./util.ts";

// const operationSchemas: Record<
//   string,
//   { query: string; node: DocumentNode } | undefined
// > = {};
// const getOperationSchema = (path: string) => {
//   if (path in operationSchemas) return operationSchemas[path]!;
//   const query = Deno.readTextFileSync(path);
//   const node = parse(query);
//   return operationSchemas[path] = { query, node };
// };

// const buildOperation = (
//   name: string,
//   path: string,
//   kind: "query" | "mutation" | "subscription",
//   names: string[],
//   schema: readonly DefinitionNode[],
//   transforms: UntypedTransforms,
//   build: Record<
//     string,
//     (
//       overrides?: unknown,
//       current?: unknown,
//       root?: unknown,
//       field?: string,
//       ancestors?: unknown[],
//     ) => unknown
//   >,
//   scalars: {
//     [name: string]: ((object: string, field: string) => unknown) | unknown;
//   },
// ): [string, OperationBuilder] => {
//   if (names.includes(name)) {
//     name = `${kind}${name[0].toUpperCase()}${name.slice(1)}`;
//   }

//   const getOperationTransforms = (mock: OperationMock) => {
//     const operationTransforms: PropertyDescriptorMap = {
//       patch: {
//         // configurable: true,
//         value: (
//           patch:
//             | Record<string, unknown>
//             | ((prev: Record<string, unknown>) => Record<string, unknown>),
//         ) => builder(typeof patch === "function" ? patch(mock) : patch, mock),
//       },
//     };

//     for (const transformName in transforms[name] ?? {}) {
//       if (transformName in mock) continue;
//       const transform = transforms[name]![transformName];
//       operationTransforms[transformName] = {
//         // configurable: true,
//         value: (...args: unknown[]) =>
//           builder(
//             typeof transform === "function"
//               ? transform(mock, ...args)
//               : transform,
//             mock,
//           ),
//       };
//     }

//     return operationTransforms;
//   };

//   const builder = (options?: Options, mock?: OperationMock) => {
//     const { query, node } = getOperationSchema(path);

//     const prevVariables = mock?.request.variables;
//     mock = { request: { query }, result: { ...mock?.result } };
//     if (prevVariables) mock.request.variables = prevVariables;

//     const operation = node.definitions.find(
//       (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
//     );
//     if (!operation) {
//       throw new Error(`Could not find operation definition in '${name}'`);
//     }

//     const defaultGenerator = transforms[name]?.default;
//     const defaults = (typeof defaultGenerator === "function"
//       ? defaultGenerator(
//         new Proxy(mock, {
//           get: (target, p) => {
//             // console.log("trap", target, p);
//             return target[p as keyof typeof target];
//           },
//         }),
//       )
//       : defaultGenerator) ?? {};
//     const dataDefault = (defaults.data as Record<string, unknown>) ?? {};
//     const variablesDefault = (defaults.variables as Record<string, unknown>) ??
//       {};

//     const variablesOverride = options?.variables ?? {};
//     for (const variable of operation.variableDefinitions ?? []) {
//       const name = variable.variable.name.value;
//       if (name in variablesOverride) {
//         if (!mock.request.variables) mock.request.variables = {};
//         mock.request.variables[name] =
//           typeof variablesOverride[name] === "function"
//             ? (variablesOverride[name] as () => unknown)()
//             : variablesOverride[name];
//         if (
//           mock.request.variables[name] != null ||
//           variable.type.kind !== "NonNullType"
//         ) continue;
//       }

//       if (
//         mock.request.variables && name in mock.request.variables &&
//         (mock.request.variables[name] != null ||
//           variable.type.kind !== "NonNullType")
//       ) continue;

//       if (name in variablesDefault) {
//         const override: unknown =
//           variablesDefault[name as keyof typeof variablesDefault];
//         if (!mock.request.variables) mock.request.variables = {};
//         mock.request.variables[name] = typeof override === "function"
//           ? override()
//           : override;
//         if (
//           mock.request.variables[name] != null ||
//           variable.type.kind !== "NonNullType"
//         ) continue;
//       }

//       if (variable.type.kind === "NonNullType") {
//         if (!mock.request.variables) mock.request.variables = {};
//         if (variable.type.type.kind === "ListType") {
//           mock.request.variables[name] = [];
//         } else {
//           // This is mostly a copy of the obj builder...
//           const fieldType = variable.type.type;
//           const typeBuilder = build[fieldType.name.value];
//           if (typeof typeBuilder === "function") {
//             mock.request.variables[name] = typeBuilder(
//               {},
//               mock.request.variables[name],
//               mock.request.variables,
//               name,
//             );
//             continue;
//           }

//           const enumDef = schema.find((d): d is EnumTypeDefinitionNode =>
//             d.kind === "EnumTypeDefinition" &&
//             d.name.value === fieldType.name.value && !!d.values?.length
//           );
//           if (enumDef?.values) {
//             mock.request.variables[name] = enumDef.values[0].name.value;
//             continue;
//           }

//           if (!(fieldType.name.value in scalars)) {
//             throw new Error(
//               `Type '${fieldType.name.value}' is not defined`,
//             );
//           }
//           const scalarDef = scalars[fieldType.name.value];
//           mock.request.variables[name] = typeof scalarDef === "function"
//             ? scalarDef(name, name)
//             : scalarDef;
//         }
//       }
//     }

//     const rootSchema = schema.find((n): n is ObjectTypeDefinitionNode =>
//       n.kind === "ObjectTypeDefinition" && n.name.value.toLowerCase() === kind
//     );
//     if (!rootSchema) throw new Error(`Could not find ${kind} in schema`);

//     const root: Record<string, unknown> = mock.result.data ?? {};
//     mock.result.data = root;

//     const rawData = options?.data;
//     const dataOverride: Patch<Record<string, unknown>> =
//       typeof rawData === "function"
//         ? rawData(variablesOverride)
//         : rawData ?? {};

//     for (const selection of operation.selectionSet.selections) {
//       if (selection.kind !== "Field") {
//         throw new Error(
//           `Expect top-level selection of operations to consist of fields, got '${selection.kind}'`,
//         );
//       }

//       const key = selection.alias?.value ?? selection.name.value;
//       let type = rootSchema.fields?.find((f) =>
//         f.name.value === selection.name.value
//       )?.type;
//       if (!type) {
//         throw new Error(
//           `Could not find type of '${selection.name.value}' on ${kind}`,
//         );
//       }

//       if (type.kind !== "NonNullType") {
//         if (!(key in dataOverride) && !(key in dataDefault) && !(key in root)) {
//           root[key] = null;
//           continue;
//         }
//       } else type = type.type;

//       // Should merge these...?
//       // const override = key in dataOverride ? dataOverride[key] : defaults[key];

//       if (type.kind === "ListType") {
//         root[key] = root[key] ?? []; // TODO
//         continue;
//       }

//       const extractTypename = (thing: unknown) => {
//         if (typeof thing === "function") thing = thing();
//         if (!thing || typeof thing !== "object" || !("__typename" in thing)) {
//           return;
//         }
//         if (typeof thing.__typename === "string") return thing.__typename;
//         if (typeof thing.__typename === "function") {
//           return thing.__typename(thing);
//         }
//       };

//       const typename = extractTypename(dataOverride[key]) ??
//         extractTypename(dataDefault[key]) ?? (() => {
//           const schemaType = schema.find((d) =>
//             "name" in d && d.name?.value === type.name.value
//           );
//           if (!schemaType) {
//             throw new Error(`Could not find type of '${type.name.value}'`);
//           }
//           if (schemaType.kind === "InterfaceTypeDefinition") {
//             const first = schema.find((d): d is ObjectTypeDefinitionNode =>
//               d.kind === "ObjectTypeDefinition"
//                 ? d.interfaces?.some((i) => i.name.value === type.name.value) ??
//                   false
//                 : false
//             );
//             if (!first) {
//               throw new Error(
//                 `Could not find implementation for interface '${type.name.value}'`,
//               );
//             }
//             return first.name.value;
//           } else if (schemaType.kind === "ObjectTypeDefinition") {
//             return schemaType.name.value;
//           }
//           throw new Error(`Unhandled kind ${schemaType.kind}`);
//         })();

//       root[key] = build[typename](
//         // TOOD: merge?
//         dataOverride[key] ?? dataDefault[key],
//         root[key],
//         undefined,
//         undefined,
//         [mock.request.variables],
//       );
//     }

//     Object.defineProperties(mock, getOperationTransforms(mock));

//     return mock;
//   };

//   Object.defineProperties(
//     builder,
//     getOperationTransforms({
//       request: { query: "TO BE REPLACED" },
//       result: {},
//     }),
//   );

//   return [name, builder as OperationBuilder];
// };

type UntypedTransforms = Record<
  string,
  | Record<
    string,
    Record<string, unknown> | ((...args: unknown[]) => Record<string, unknown>)
  >
  | undefined
>;

// const buildObject = (
//   name: string,
//   schema: readonly DefinitionNode[],
//   scalars: {
//     [name: string]: ((object: string, field: string) => unknown) | unknown;
//   },
//   transforms: UntypedTransforms,
// ): ObjectBuilder<unknown, unknown> => {

// };
//   const type =
//     schema.find((d): d is ObjectTypeDefinitionNode =>
//       (d.kind === "ObjectTypeDefinition" ||
//         d.kind === "InputObjectTypeDefinition") &&
//       d.name.value === name
//     ) ?? raise(`Could not find object type definition '${name}'`);

//   const arr: Record<string, unknown>[] = [];

//   const getObjTransforms = (obj: Record<string, unknown>) => {
//     const objTransforms: PropertyDescriptorMap = {
//       patch: {
//         configurable: true,
//         value: (
//           patch:
//             | Record<string, unknown>
//             | ((prev: Record<string, unknown>) => Record<string, unknown>),
//         ) =>
//           builder(typeof patch === "function" ? patch(obj) : patch, { ...obj }),
//       },
//     };

//     for (const transformName in transforms[name] ?? {}) {
//       if (transformName in obj) continue;
//       const transform = transforms[name]![transformName];
//       objTransforms[transformName] = {
//         value: (...args: unknown[]) =>
//           builder(
//             typeof transform === "function"
//               ? transform(obj, ...args)
//               : transform,
//             { ...obj },
//           ),
//       };
//     }

//     return objTransforms;
//   };

//   const builder = (
//     overrides?: Record<string, unknown>,
//     obj: Record<string, unknown> = {},
//     root?: unknown,
//     field?: string,
//     args: unknown[] = [],
//   ) => {
//     if (!obj || typeof obj !== "object") obj = {};
//     if (!root) root = obj;
//     else if (field) root = { ...root, [field]: obj };

//     obj.__typename = name;

//     const defaultTransform = transforms[name]?.default ?? {};
//     const defaults = typeof defaultTransform === "function"
//       ? defaultTransform(obj)
//       : defaultTransform;
//     for (const field of type.fields ?? []) {
//       if (overrides && field.name.value in overrides) {
//         const override = overrides[field.name.value];
//         const value = typeof override === "function"
//           ? override(root, ...args)
//           : override;

//         if (isObject(value)) {
//           let fieldType = field.type;
//           while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
//           const typeBuilder = build[fieldType.name.value];
//           if (typeBuilder) {
//             obj[field.name.value] = typeBuilder(
//               value,
//               obj[field.name.value],
//               root,
//               field.name.value,
//               args,
//             );
//           } else {
//             console.warn(
//               `Didn't find builder for '${fieldType.name.value}', replacing entirely`,
//             );
//             obj[field.name.value] = value;
//           }
//         } else obj[field.name.value] = value;
//         if (value != null || field.type.kind !== "NonNullType") continue;
//         else delete obj[field.name.value];
//       }

//       if (field.name.value in obj) {
//         // do nothing; it's already set!
//       } else if (field.name.value in defaults) {
//         const d = defaults[field.name.value];
//         const value = typeof d === "function" ? d(root, ...args) : d;
//         if (isObject(value)) {
//           let fieldType = field.type;
//           while (fieldType.kind !== "NamedType") fieldType = fieldType.type;
//           const typeBuilder = build[fieldType.name.value];
//           if (typeBuilder) {
//             obj[field.name.value] = typeBuilder(
//               Object.assign(
//                 {},
//                 obj[field.name.value],
//                 value,
//                 overrides ? overrides[field.name.value] : {},
//                 args,
//               ),
//             );
//           } else obj[field.name.value] = value;
//         } else obj[field.name.value] = value;
//       } else if (field.type.kind !== "NonNullType") {
//         obj[field.name.value] = null;
//       } else if (field.type.type.kind === "ListType") {
//         obj[field.name.value] = [];
//       } else {
//         const fieldType = field.type.type;
//         const typeBuilder = build[fieldType.name.value];
//         if (typeBuilder) {
//           obj[field.name.value] = typeBuilder(
//             {},
//             obj[field.name.value],
//             obj,
//             field.name.value,
//             args,
//           );
//           continue;
//         }

//         const enumDef = schema.find((d): d is EnumTypeDefinitionNode =>
//           d.kind === "EnumTypeDefinition" &&
//           d.name.value === fieldType.name.value && !!d.values?.length
//         );
//         if (enumDef?.values) {
//           obj[field.name.value] = enumDef.values[0].name.value;
//           continue;
//         }

//         if (!(fieldType.name.value in scalars)) {
//           throw new Error(
//             `Type '${fieldType.name.value}' is not defined`,
//           );
//         }
//         const scalarDef = scalars[field.type.type.name.value];
//         obj[field.name.value] = typeof scalarDef === "function"
//           ? scalarDef(name, field.name.value)
//           : scalarDef;
//       }
//     }

//     Object.defineProperties(obj, getObjTransforms(obj));

//     arr.push(obj);

//     return obj;
//   };

//   Object.defineProperties(builder, {
//     length: { get: () => arr.length },
//     find: { value: arr.find.bind(arr) },
//     findBy: {
//       value: (value: unknown, key: string = "id") =>
//         arr.find((v) => v[key] === value),
//     },
//     last: { get: () => arr[arr.length - 1] },
//     filter: {
//       value: (filter: (v: Record<string, unknown>) => boolean) =>
//         arr.filter(filter),
//     },
//     all: { get: () => [...arr] },
//     ...getObjTransforms({}),
//   });

//   return builder as unknown as ObjectBuilder<unknown, unknown>;
// };

const files: Record<string, string> = {};

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
): Build<
  Query,
  Mutation,
  Subscription,
  Types,
  Inputs,
  Transforms
> => {
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

  type GenericPatch = Patch<(Types & Inputs)[keyof Types & string]>;
  const addObjectTransforms = (type: string, obj: unknown) => {
    Object.defineProperty(obj, "patch", {
      value: (...patches: GenericPatch[]) =>
        build[type]!(
          (typeof obj === "function" ? obj() : obj) as GenericPatch,
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
              : fn) as GenericPatch;
            return build[type]!(prev as GenericPatch, patch as GenericPatch);
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

  const addOperationTransforms = (operation: string, obj: unknown) => {
    Object.defineProperty(obj, "patch", {
      value: (...patches: GenericPatch[]) => {
        const prev = (typeof obj === "function" ? obj() : obj) as OperationMock;
        return build[operation]!(
          {
            data: prev.result.data,
            variables: prev.request.variables,
            error: prev.error,
            errors: prev.result.errors,
          } as any,
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
            const patch = (typeof fn === "function"
              ? fn(prevInput as any, ...args)
              : fn) as GenericPatch;
            return build[operation]!(
              prevInput as any,
              patch as GenericPatch,
            );
          },
        }]),
      ),
    );
    return obj;
  };

  type OperationPatch = Shift<
    Shift<Shift<Parameters<typeof operation>>>
  >[number];
  const operationBuilder = (name: string, path: string) =>
    addOperationTransforms(name, (...patches: OperationPatch[]) => {
      const query = files[path] ?? (files[path] = Deno.readTextFileSync(path));
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
        operationBuilder(mutation, mutations[mutation]) as any;
    }
  }

  // Object.assign(
  //   transforms,
  //   fn(
  //     build as Build<
  //       Query,
  //       Mutation,
  //       Subscription,
  //       Types,
  //       Inputs,
  //       EmptyObject
  //     >,
  //   ),
  // );

  return build as Build<
    Query,
    Mutation,
    Subscription,
    Types,
    Inputs,
    Transforms
  >;
};
