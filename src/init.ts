import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  DefinitionNode,
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  Kind,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  parse,
  SelectionSetNode,
  TypeNode,
} from "npm:graphql";
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
import { _proxy, operation, proxy as _proxy_unused, withGetDefaultPatch } from "./proxy.ts";
import { toObject } from "./util.ts";
import { dirname, resolve } from "node:path";

type UnknownFunction = (...args: unknown[]) => unknown;

globalThis.require ??= createRequire(Deno.cwd());
const files: Record<string, string> = {};
const loadFile = (path: string): string => {
  if (files[path]) return files[path];
  const raw = readFileSync(path, "utf-8");
  const imports = Array.from(
    raw.matchAll(/#import "(.*)"/gm),
    ([, importPath]) =>
      loadFile(
        require.resolve(
          importPath.startsWith(".")
            ? resolve(Deno.cwd(), dirname(path), importPath)
            : importPath,
          { paths: [Deno.cwd()] },
        ),
      ),
  );
  if (!imports.length) return files[path] = raw;

  return files[path] = [raw, ...imports].join("\n\n");
};

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

  try {
    // First try loading via require, depending on GQL loaders
    const doc: unknown = require(
      require.resolve(path, { paths: [Deno.cwd()] }),
    );
    if (
      doc && typeof doc === "object" && "kind" in doc && doc.kind === "Document"
    ) {
      getOperationContentMap[path] = doc as DocumentNode;
    }
  } catch {
    // Otherwise load it manually
    const fileContent = loadFile(path);
    try {
      const sources = gqlPluckFromCodeStringSync(path, fileContent);
      getOperationContentMap[path] = Object.fromEntries(sources.map((s) => {
        const document = parse(s);
        const firstOp = document.definitions.find((d) =>
          d.kind === Kind.OPERATION_DEFINITION
        );
        if (!firstOp) throw new Error(`Could not find an operation in ${path}`);

        return [firstOp.name?.value, document];
      }));
    } catch {
      getOperationContentMap[path] = parse(fileContent);
    }
  }

  return getOperationContent(path, operationName);
};

// Helper: Unwraps non-null and list wrappers to get the named type.
const getNamedType = (type: TypeNode): string =>
  type.kind === Kind.NAMED_TYPE ? type.name.value : getNamedType(type.type);

// Helper: Find a type definition in the document by name.
const getTypeDef = (definitions: readonly DefinitionNode[], typeName: string) =>
  definitions.find(
    (def) => "name" in def && def.name?.value === typeName,
  );

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Initialize the data builder.
 * @param schema The plain text of your schema.
 * @param queries List of queries exported from generated types.
 * @param mutations List of mutations exported from generated types.
 * @param subscriptions List of subscriptions exported from generated types.
 * @param types List of types exported from generated types.
 * @param inputs List of types exported from generated types.
 * @param scalars A mapping to generate scalar values. Function values will be invoked with their `__typename`.
 */
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
  types: { readonly [type in keyof Types]: readonly string[] },
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
  
  // Collect all fragment definitions from operation files
  const fragmentDefinitions: FragmentDefinitionNode[] = [];
  const collectFragments = (filePath: string, operationName?: string) => {
    try {
      // If we have an operation name, use it; otherwise try to parse the file directly
      let document: DocumentNode;
      if (operationName) {
        document = getOperationContent(filePath, operationName);
      } else {
        // Parse the file directly to get all definitions including fragments
        const fileContent = loadFile(filePath);
        document = parse(fileContent);
      }
      
      fragmentDefinitions.push(
        ...document.definitions.filter((def): def is FragmentDefinitionNode => 
          def.kind === Kind.FRAGMENT_DEFINITION
        )
      );
    } catch {
      // Ignore files that can't be parsed
    }
  };
  
  // Collect fragments from all operation files (parse entire files to get all fragments)
  Object.values(queries).forEach(path => collectFragments(path));
  Object.values(mutations).forEach(path => collectFragments(path));
  Object.values(subscriptions).forEach(path => collectFragments(path));
  
  // Combine schema definitions with fragment definitions
  const allDefinitions = [...doc.definitions, ...fragmentDefinitions];

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

  const getSelectionSetMemory = new Map<string, SelectionSetNode>();
  const getSelectionSet = (type: string): SelectionSetNode | undefined => {
    if (getSelectionSetMemory.has(type)) {
      return getSelectionSetMemory.get(type)!;
    }
    const fields = types[type];
    if (!fields) return;

    const typeDef = getTypeDef(allDefinitions, type);
    if (!typeDef || !("fields" in typeDef)) return;

    const selectionSet: SelectionSetNode = {
      kind: Kind.SELECTION_SET,
      selections: [],
    };
    getSelectionSetMemory.set(type, selectionSet);

    // Build each field node.
    selectionSet.selections = fields.map((fieldName): FieldNode => {
      const fieldNode: Writeable<FieldNode> = {
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: fieldName },
      };

      // Look for the field definition in the type definition.
      const fieldDef = typeDef.fields?.find(
        (f) => f.name.value === fieldName,
      );
      if (fieldDef) {
        // Get the inner (named) type of the field.
        const fieldTypeName = getNamedType(fieldDef.type);
        const fieldTypeDef = getTypeDef(allDefinitions, fieldTypeName);

        // If the field is an Object, build its selection set recursively.
        if (
          fieldTypeDef &&
          fieldTypeDef.kind === Kind.OBJECT_TYPE_DEFINITION
        ) {
          const childSelection = getSelectionSet(fieldTypeName);
          if (childSelection) fieldNode.selectionSet = childSelection;
        } // If the field is an Interface, treat it like a union:
        // find all Object types that implement this interface and build inline fragments.
        else if (fieldTypeDef?.kind === Kind.INTERFACE_TYPE_DEFINITION) {
          const implementingTypes = allDefinitions.filter(
            (def): def is ObjectTypeDefinitionNode =>
              def.kind === Kind.OBJECT_TYPE_DEFINITION &&
              (def.interfaces?.some(
                (iface: NamedTypeNode) => iface.name.value === fieldTypeName,
              ) ?? false),
          );
          const inlineFragments = implementingTypes.map((
            impl,
          ): InlineFragmentNode => ({
            kind: Kind.INLINE_FRAGMENT,
            typeCondition: {
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: impl.name.value },
            },
            selectionSet: getSelectionSet(impl.name.value) ?? {
              kind: Kind.SELECTION_SET,
              selections: [],
            },
          }));
          fieldNode.selectionSet = {
            kind: Kind.SELECTION_SET,
            selections: inlineFragments,
          };
        } // For Unions, build inline fragments for each member type.
        else if (fieldTypeDef?.kind === Kind.UNION_TYPE_DEFINITION) {
          const inlineFragments = fieldTypeDef.types?.map((
            member: NamedTypeNode,
          ): InlineFragmentNode => ({
            kind: Kind.INLINE_FRAGMENT,
            typeCondition: {
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: member.name.value },
            },
            selectionSet: getSelectionSet(member.name.value) ?? {
              kind: Kind.SELECTION_SET,
              selections: [],
            },
          })) ?? [];
          fieldNode.selectionSet = {
            kind: Kind.SELECTION_SET,
            selections: inlineFragments,
          };
        }
        // Scalars and enums don't require a nested selection.
      }
      return fieldNode;
    });

    return selectionSet;
  };

  const wrap = <T>(
    type: string,
    patches: Patch<T>[],
  ) =>
    withGetDefaultPatch(
      <U>(type: string) => transforms[type]?.default as Patch<U>,
      () =>
        toObject(
          _proxy<T>(allDefinitions, scalars, type, patches, {
            selectionSet: getSelectionSet(type),
          }),
        ),
    );

  const objectBuilder = <T>(type: string) =>
    addObjectTransforms(type, (...patches: (Patch<T>)[]) => {
      if (transforms[type] && "default" in transforms[type]) {
        patches = [
          transforms[type].default as Patch<T>,
          ...patches,
        ];
      }
      return addObjectTransforms(
        type,
        wrap(type, patches),
      );
    });

  for (const type in types) {
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
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, ...rest } = typeof obj === "function"
            ? obj()
            : obj;
          return builder(
            {
              data: result.data,
              variables: request.variables,
              errors: result.errors,
              ...rest,
            },
            ...patches,
          );
        },
      },
      variables: {
        value: (variables: Patch<unknown>) => {
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, ...rest } = typeof obj === "function"
            ? obj()
            : obj;
          const mock = builder(
            {
              data: result.data,
              variables: request.variables,
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
            (obj as { variables: UnknownFunction }).variables,
          );
          return mock;
        },
      },
      data: {
        value: (data: Patch<unknown>) => {
          const builder = build[operation]! as (
            ...patches: OperationPatch[]
          ) => OperationMock;
          const { result, request, ...rest } = typeof obj === "function"
            ? obj()
            : obj;
          const mock = builder(
            {
              data: result.data,
              variables: request.variables,
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
            (obj as { data: UnknownFunction }).data,
          );
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
            const { result, request, ...rest } = typeof obj === "function"
              ? obj()
              : obj;
            const prevInput = {
              data: result.data,
              variables: request.variables,
              errors: result.errors,
              ...rest,
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
              (obj as Record<string, UnknownFunction>)[name],
            );
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
      const { mock, parsedQuery } = withGetDefaultPatch(
        <U>(type: string) => transforms[type]?.default as Patch<U>,
        () => {
          const { request: { query: parsedQuery, ...request }, ...raw } =
            operation(allDefinitions, scalars, query, ...patches);
          const mock = toObject({
            request: { ...request },
            ...raw,
          }) as ReturnType<typeof operation>;
          return { mock, parsedQuery };
        },
      );
      mock.request.query = parsedQuery;
      Error.captureStackTrace(mock, builder);
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
      ...Object.keys(types),
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
      ...Object.keys(types),
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
      ...Object.keys(types),
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
