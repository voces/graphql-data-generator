import { readFile } from "node:fs/promises";
import type {
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  FragmentDefinitionNode,
  GraphQLSchema,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  ListTypeNode,
  NamedTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  OperationDefinitionNode,
  ScalarTypeDefinitionNode,
  SelectionNode,
  TypeDefinitionNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from "npm:graphql";
import { Kind, parse, printSchema } from "npm:graphql";
import fg from "npm:fast-glob";
import { join, relative } from "node:path";
import { raise } from "./util.ts";
import process from "node:process";
import {
  convertFactory,
  type NamingConvention,
} from "npm:@graphql-codegen/visitor-plugin-common";

type SerializableType =
  | { kind: "Name"; value: string; optional: boolean }
  | { kind: "List"; value: SerializableType; optional: boolean }
  | {
    kind: "Object";
    value: Record<string, SerializableType>;
    conditionals?: SerializableType[];
    optional: boolean;
    nonExhaustive?: string[];
  }
  | { kind: "Union"; value: SerializableType[]; optional: boolean }
  | { kind: "StringLiteral"; value: string; optional: boolean };

const getType = (
  { type, ...props }: {
    type: NamedTypeNode | ListTypeNode | NonNullTypeNode;
    optional?: boolean;
    selections?: readonly SelectionNode[];
    definitions: Record<string, [TypeDefinitionNode, Set<string>] | undefined>;
    fragments: Record<string, FragmentDefinitionNode | undefined>;
    references: Record<string, [TypeDefinitionNode, boolean] | undefined>;
    includeTypenames: boolean;
  },
): SerializableType => {
  if (type.kind === "NamedType") {
    if (props.selections) {
      const def = props.definitions[type.name.value];
      const implementations = def?.[0].kind === "InterfaceTypeDefinition"
        ? Object.values(props.definitions)
          .filter((v): v is [TypeDefinitionNode, Set<string>] =>
            v?.[0].kind === "ObjectTypeDefinition" &&
              v[0].interfaces?.some((i) =>
                i.name.value === def[0].name.value
              ) ||
            false
          )
        : def?.[0].kind === "UnionTypeDefinition"
        ? Object.values(props.definitions)
          .filter((v): v is [TypeDefinitionNode, Set<string>] =>
            "types" in def[0] &&
              def[0].types?.some((t) =>
                v && t.name.value === v[0].name.value
              ) ||
            false
          )
        : [];

      const groupedValues = getSelectionsType(
        type.name.value,
        props.selections,
        props.definitions,
        props.fragments,
        props.references,
        props.includeTypenames,
      ).reduce(
        (union, [name, value, group, originalName]) => {
          group ??= type.name.value;
          // Extract the actual type name from compound group names (e.g., "User:DelegationSubject" -> "DelegationSubject")
          const actualTypeName = group.includes(":")
            ? group.split(":").pop()!
            : group;

          if (!union[group]) {
            union[group] = {};
            const shouldIncludeTypename = props.includeTypenames &&
              props.definitions[actualTypeName]?.[0].kind ===
                "ObjectTypeDefinition";

            Object.defineProperty(union[group], "__typename", {
              enumerable: shouldIncludeTypename,
              value: {
                kind: "StringLiteral",
                value: actualTypeName,
                optional: false,
              },
            });
          }
          union[group]![name] = value;
          const def = props.definitions[actualTypeName];
          // Use originalName for tracking field usage when field is aliased
          const fieldNameForTracking = originalName ?? name;
          if (def) {
            if (implementations.length) {
              for (const implementation of implementations) {
                implementation[1].add(fieldNameForTracking);
              }
            } else def[1].add(fieldNameForTracking);
          }

          return union;
        },
        {} as Record<string, Record<string, SerializableType>>,
      );

      const value = groupedValues[type.name.value] ?? {};
      delete groupedValues[type.name.value];

      if (def?.[0].kind === "UnionTypeDefinition") {
        def[1].add(type.name.value);

        // This is a terrible solution and we should instead produce a tree that
        // is simplified
        let iface = props.definitions[def[0].types?.[0]?.name.value ?? ""]?.[0];
        if (iface && "interfaces" in iface) {
          iface = props.definitions[iface.interfaces?.[0]?.name.value ?? ""]
            ?.[0];
        }
        const interfaceName = iface?.kind === "InterfaceTypeDefinition"
          ? iface.name.value
          : undefined;
        if (
          interfaceName &&
          groupedValues[interfaceName] &&
          Object.keys(groupedValues).every((k) =>
            k === interfaceName ||
            (def[0] as UnionTypeDefinitionNode).types?.some((t) =>
              t.name.value === k
            )
          )
        ) {
          Object.assign(value, groupedValues[interfaceName]);
          delete groupedValues[interfaceName];
        }
      } else if (def?.[0].kind === "InterfaceTypeDefinition") {
        def[1].add(type.name.value);
      }

      const nonExhaustive = implementations
        .filter((o) => {
          const typeName = o[0].name.value;
          // Check if this type is covered either directly or in compound groups
          return !(typeName in groupedValues) &&
            !Object.keys(groupedValues).some((key) =>
              key.includes(":") && key.endsWith(":" + typeName)
            );
        }).map((o) => o[0].name.value);

      return {
        kind: "Object",
        value,
        conditionals: Object.values(groupedValues).map((value) => ({
          kind: "Object",
          value,
          optional: false,
        })),
        nonExhaustive,
        optional: props.optional ?? true,
      };
    }

    const reference = props.references[type.name.value];
    if (reference) reference[1] = true;

    return {
      kind: "Name",
      value: type.name.value,
      optional: props.optional ?? true,
    };
  } else if (type.kind === "NonNullType") {
    return getType({ ...props, type: type.type, optional: false });
  } else if (type.kind === "ListType") {
    return {
      kind: "List",
      value: getType({ ...props, type: type.type, optional: true }),
      optional: props.optional ?? true,
    };
  } else throw new Error(`Unhandled type '${type}'`);
};

type SelectionType = [
  name: string,
  type: SerializableType,
  group?: string,
  originalName?: string,
];
const getSelectionsType = (
  name: string,
  selections: readonly SelectionNode[],
  definitions: Record<string, [TypeDefinitionNode, Set<string>] | undefined>,
  fragments: Record<string, FragmentDefinitionNode | undefined>,
  references: Record<string, [TypeDefinitionNode, boolean] | undefined>,
  includeTypenames: boolean,
): SelectionType[] => {
  const selectionTypes: SelectionType[] = [];
  for (const selection of selections) {
    switch (selection.kind) {
      case "Field": {
        const selectionType = definitions[name];

        if (!selectionType) {
          throw new Error(
            `Could not find type '${selection.name.value}' in '${name}'`,
          );
        }

        switch (selectionType[0].kind) {
          case "ObjectTypeDefinition":
          case "InterfaceTypeDefinition": {
            const fieldType = selectionType[0].fields?.find((f) =>
              f.name.value === selection.name.value
            );
            if (!fieldType) {
              throw new Error(
                `Could not find field '${selection.name.value}' on type '${name}'`,
              );
            }

            selectionTypes.push([
              selection.alias?.value ?? selection.name.value,
              getType({
                type: fieldType.type,
                selections: selection.selectionSet?.selections,
                definitions,
                fragments,
                references,
                includeTypenames,
              }),
              undefined, // group
              selection.alias ? selection.name.value : undefined, // originalName when aliased
            ]);

            break;
          }
          case "UnionTypeDefinition": {
            const types = selectionType[0].types;
            if (!types) {
              throw new Error(
                `Expected types to be present on union '${
                  selectionType[0].name.value
                }'`,
              );
            }
            selectionTypes.push(
              ...getSelectionsType(
                types[0].name.value, // Assuming the selection is in all types
                [selection],
                definitions,
                fragments,
                references,
                includeTypenames,
              ),
            );
            break;
          }
          default:
            throw new Error(
              `Unhandled selection type '${selectionType[0].kind}'`,
            );
        }

        break;
      }
      case "InlineFragment": {
        const subSelection = getSelectionsType(
          selection.typeCondition?.name.value ?? name,
          selection.selectionSet.selections,
          definitions,
          fragments,
          references,
          includeTypenames,
        );

        const group = selection.typeCondition?.name.value ??
          selection.directives?.map((d) => d.name).join(",");

        selectionTypes.push(
          ...(group
            ? subSelection.map((
              [n, t, g, originalName],
              // Test: nested fragments?
            ): SelectionType => [
              n,
              t,
              g ? `${group}:${g}` : group,
              originalName,
            ])
            : subSelection),
        );

        break;
      }
      case "FragmentSpread": {
        const fragment = fragments[selection.name.value];
        if (!fragment) {
          throw new Error(
            `Could not find fragment '${selection.name.value}' in '${name}'`,
          );
        }
        // Fragment is automatically considered used
        selectionTypes.push(
          ...getSelectionsType(
            fragment.typeCondition.name.value,
            fragment.selectionSet.selections,
            definitions,
            fragments,
            references,
            includeTypenames,
          ).map((
            [name, type, group, originalName],
          ): SelectionType => [
            name,
            type,
            group || fragment.typeCondition.name.value,
            originalName,
          ]),
        );
        break;
      }
      default:
        throw new Error(`Unhandled selection kind '${selection.kind}'`);
    }
  }
  return selectionTypes;
};

const getOperationType = (
  operation: OperationDefinitionNode,
  definitions: Record<string, [TypeDefinitionNode, Set<string>] | undefined>,
  fragments: Record<string, FragmentDefinitionNode>,
  root: Record<string, FieldDefinitionNode | undefined>,
  references: Record<string, [TypeDefinitionNode, boolean] | undefined>,
  includeTypenames: boolean,
): SerializableType => ({
  kind: "Object",
  value: Object.fromEntries(
    operation.selectionSet.selections.map((selection) => {
      if (selection.kind !== "Field") {
        throw new Error(
          `Expected top-level selection on operation to be field, got '${selection.kind}'`,
        );
      }

      const definition = root[selection.name.value];
      if (!definition) {
        throw new Error(
          `Could not find definition '${selection.name.value}'`,
        );
      }

      return [
        selection.alias?.value ?? selection.name.value,
        getType({
          type: definition.type,
          selections: selection.selectionSet?.selections,
          definitions,
          fragments,
          references,
          includeTypenames,
        }),
      ] as const;
    }),
  ),
  optional: false,
});

const getOperationVariables = (
  operation: OperationDefinitionNode,
  references: Record<string, [TypeDefinitionNode, boolean] | undefined>,
): SerializableType => ({
  kind: "Object",
  value: Object.fromEntries(
    operation.variableDefinitions?.map((
      v,
    ) => [
      v.variable.name.value,
      getType({
        type: v.type,
        references,
        definitions: {},
        fragments: {},
        includeTypenames: false,
      }),
    ]) ?? [],
  ),
  optional: false,
});

const serializeType = (
  type: SerializableType,
  variables = false,
  depth = 0,
): string => {
  switch (type.kind) {
    case "Name":
      return `${type.value}${type.optional ? " | null" : ""}`;
    case "List":
      if (
        type.value.optional ||
        (type.value.kind === "Object" &&
          ((type.value.conditionals?.length ?? 0) -
            (Object.keys(type.value.value).length ? 0 : 1)))
      ) {
        return `(${serializeType(type.value, variables, depth)})[]${
          type.optional ? " | null" : ""
        }`;
      }
      return `${serializeType(type.value, variables, depth)}[]${
        type.optional ? " | null" : ""
      }`;
    case "Object": {
      const content = Object.entries(type.value).map(([key, value]) =>
        `${"  ".repeat(depth + 1)}${key}${
          value.optional && variables ? "?" : ""
        }: ${serializeType(value, variables, depth + 1)};`
      ).join("\n");
      const ands = [
        `{${content ? `\n${content}\n${"  ".repeat(depth)}` : ""}}`,

        ...(type.conditionals?.filter((c) =>
          c.kind !== "Object" || !c.value.__typename
        )?.map((c) => `(${serializeType(c, variables, depth + 1)} | {})`) ??
          []),
      ];

      const ors = type.conditionals
        ?.filter((c) => c.kind === "Object" && c.value.__typename)
        .map((c) => serializeType(c, variables, depth)) ?? [];

      if (type.nonExhaustive?.length && ors.length) {
        ors.push(
          `{ __typename: ${
            type.nonExhaustive.map((v) => `"${v}"`).join(" | ")
          } }`,
        );
      }

      // TODO: Ideally this would be better formatted, but then I need to track
      // depth
      return `${
        [
          ands[0] === "{}" ? undefined : ands[0],
          ors.length > 1 && (ands.length !== 1 || ands[0] !== "{}")
            ? `(${ors.join(" | ")})`
            : ors.join(" | "),
          ...ands.slice(1),
        ].filter(Boolean).join(" & ")
      }${type.optional ? " | null" : ""}`;
    }
    case "Union":
      return type.value.map((member) => serializeType(member, variables, depth))
        .join(" | ") +
        (type.optional ? " | null" : "");
    case "StringLiteral":
      return `"${type.value}"`;
  }
};

const drop = () => false;

const serializeInput = (
  fields: readonly InputValueDefinitionNode[],
  optional: boolean,
  inputs: Record<
    string,
    [InputObjectTypeDefinitionNode, Set<string>] | undefined
  >,
  references: Record<string, [TypeDefinitionNode, boolean] | undefined>,
): SerializableType => ({
  kind: "Object",
  value: Object.fromEntries(
    fields.map(
      (
        f,
      ) => [
        f.name.value,
        fillOutInput(
          getType({
            type: f.type,
            references,
            definitions: {},
            fragments: {},
            includeTypenames: false,
          }),
          inputs,
          references,
        ),
      ],
    ),
  ),
  optional,
});

const fillOutInput = (
  input: SerializableType,
  inputs: Record<
    string,
    [InputObjectTypeDefinitionNode, Set<string>] | undefined
  >,
  references: Record<string, [TypeDefinitionNode, boolean] | undefined>,
): SerializableType => {
  switch (input.kind) {
    case "List":
      return { ...input, value: fillOutInput(input.value, inputs, references) };
    case "Object":
      return {
        ...input,
        value: Object.fromEntries(
          Object.entries(input.value).map((
            [k, v],
          ) => [k, fillOutInput(v, inputs, references)]),
        ),
      };
    case "Name": {
      const def = inputs[input.value];
      if (!def) return input;
      return serializeInput(
        def[0].fields ?? [],
        input.optional,
        inputs,
        references,
      );
    }
    case "Union":
      return {
        ...input,
        value: input.value.map((member) =>
          fillOutInput(member, inputs, references)
        ),
      };
    case "StringLiteral":
      return input;
  }
};

type Operation = {
  name: string;
  path: string;
  definition: OperationDefinitionNode;
};

const operationNames: Record<string, { types: string; list: string }> = {
  query: { types: "Query", list: "queries" },
  mutation: { types: "Mutation", list: "mutations" },
  subscription: { types: "Subscription", list: "subscriptions" },
};

const simpleType = (
  type: TypeNode,
  types: Record<string, [TypeDefinitionNode, Set<string>] | undefined>,
  optional = true,
): SerializableType => {
  switch (type.kind) {
    case Kind.NON_NULL_TYPE:
      return simpleType(type.type, types, false);
    case Kind.LIST_TYPE:
      return {
        kind: "List",
        value: simpleType(type.type, types),
        optional,
      };
    case Kind.NAMED_TYPE:
      return {
        kind: "Name",
        value: type.name.value,
        optional,
      };
  }
};

const defaultScalars = {
  Int: "number",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string",
};

export const codegen = (
  schema: GraphQLSchema | string,
  files: { path: string; content: string }[],
  {
    enums = "literals",
    scalars,
    includeTypenames = true,
    exports = [],
    typesFile,
    namingConvention,
    omitOperationSuffix = !typesFile,
  }: {
    enums?: string;
    scalars?: Record<string, string | undefined>;
    includeTypenames?: boolean;
    exports?: ("types" | "operations")[];
    typesFile?: string;
    namingConvention?: NamingConvention;
    omitOperationSuffix?: boolean;
  } = {},
): string => {
  const rename = namingConvention || typesFile
    ? convertFactory({ namingConvention: namingConvention ?? "keep" })
    : <T>(v: T) => v;

  const schemaDoc = parse(
    typeof schema === "string" ? schema : printSchema(schema),
  );

  scalars = { ...defaultScalars, ...scalars };

  const types: Record<
    string,
    | [
      | ObjectTypeDefinitionNode
      | InterfaceTypeDefinitionNode
      | UnionTypeDefinitionNode,
      usage: Set<string>,
    ]
    | undefined
  > = {};
  const inputs: Record<
    string,
    [InputObjectTypeDefinitionNode, Set<string>] | undefined
  > = {};
  const fragments: Record<string, FragmentDefinitionNode> = {};
  const references: Record<
    string,
    [
      definition: ScalarTypeDefinitionNode | EnumTypeDefinitionNode,
      used: boolean,
    ]
  > = Object.fromEntries(
    ["Int", "Float", "String", "Boolean", "ID"].map((
      name,
    ): [string, [ScalarTypeDefinitionNode, boolean]] => [name, [{
      kind: Kind.SCALAR_TYPE_DEFINITION,
      name: { kind: Kind.NAME, value: name },
    }, false]]),
  );
  let query: Record<string, FieldDefinitionNode | undefined> = {};
  let mutation: Record<string, FieldDefinitionNode | undefined> = {};
  let subscription: Record<string, FieldDefinitionNode | undefined> = {};

  let queryKey = "Query";
  let mutationKey = "Mutation";
  let subscriptionKey = "Subscription";

  for (const definition of schemaDoc.definitions) {
    switch (definition.kind) {
      case "SchemaDefinition":
        {
          for (const operationType of definition.operationTypes) {
            switch (operationType.operation) {
              case "query":
                queryKey = operationType.type.name.value;
                break;
              case "mutation":
                mutationKey = operationType.type.name.value;
                break;
              case "subscription":
                subscriptionKey = operationType.type.name.value;
                break;
            }
          }
        }
        break;
      case "ObjectTypeDefinition":
        if (definition.name.value === queryKey) {
          query = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else if (definition.name.value === mutationKey) {
          mutation = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else if (definition.name.value === subscriptionKey) {
          subscription = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else types[definition.name.value] = [definition, new Set()];
        break;
      case "InputObjectTypeDefinition":
        inputs[definition.name.value] = [definition, new Set()];
        break;
      case "InterfaceTypeDefinition":
        types[definition.name.value] = [definition, new Set()];
        break;
      case "UnionTypeDefinition":
        types[definition.name.value] = [definition, new Set()];
        break;
      case "EnumTypeDefinition":
        if (!references[definition.name.value]) {
          references[definition.name.value] = [definition, false];
        } else {
          const prev =
            references[definition.name.value][0] as EnumTypeDefinitionNode;
          references[definition.name.value][0] = {
            ...prev,
            values: [
              ...(prev.values ?? []),
              ...(definition.values ?? []),
            ],
          };
        }
        break;
      case "ScalarTypeDefinition":
        references[definition.name.value] = [definition, false];
        break;
    }
  }

  const roots = { query, mutation, subscription };

  const operations = {
    query: [] as Operation[],
    mutation: [] as Operation[],
    subscription: [] as Operation[],
  };

  for (const { path, content } of files) {
    const dom = parse(content);
    for (const definition of dom.definitions) {
      switch (definition.kind) {
        case "OperationDefinition": {
          const name = definition.name?.value;
          if (!name) {
            console.warn(`Skipping unnamed operation in '${path}'`);
            continue;
          }
          if (operations[definition.operation].some((o) => o.name === name)) {
            console.warn(`Skipping duplicate operation '${name}'`);
            continue;
          }
          operations[definition.operation].push({
            name,
            path,
            definition: definition,
          });
          break;
        }
        case "FragmentDefinition":
          fragments[definition.name.value] = definition;
          break;
        default:
          throw new Error(
            `Unhandled definition kind '${definition.kind}' in operation file '${path}'`,
          );
      }
    }
  }

  const operationDataName = (operation: Operation, type: string) => {
    const name = operation.name;
    if (inputs[name] || types[name] || !omitOperationSuffix) {
      return rename(`${name}${type[0].toUpperCase()}${type.slice(1)}`);
    }
    for (const key in operations) {
      if (type === key) continue;
      if (
        operations[key as keyof typeof operations].some((o) => o.name === name)
      ) return `${name}${type[0].toUpperCase()}${type.slice(1)}`;
    }
    return name;
  };

  const handledInputs = new Set<string>();

  const filterOutputTypes = typesFile ? drop : Boolean;

  const serializedTypes = Object.entries(operations).filter(([, v]) => v.length)
    .flatMap((
      [operationType, collection],
    ) => [
      ...collection.flatMap((c) =>
        c.definition.variableDefinitions?.map(
          (v) => {
            let type = getType({
              type: v.type,
              definitions: inputs,
              references,
              fragments: {},
              includeTypenames: false,
            });
            let inputType = fillOutInput(type, inputs, references);

            if (JSON.stringify(type) === JSON.stringify(inputType)) return;

            if (type.kind === "List") type = type.value;
            if (inputType.kind === "List") inputType = inputType.value;

            if (type.kind !== "Name") {
              throw new Error(
                `Could not find type for variable '${v.variable.name.value}'`,
              );
            }

            if (handledInputs.has(type.value) || !inputs[type.value]) return;
            const stack = [type.value];
            while (stack.length) {
              const current = stack.pop()!;
              const def = inputs[current]?.[0];
              if (!def) {
                throw new Error(`Could not find nested input '${current}'`);
              }
              const subFieldTypes = def.fields?.map((f) => {
                let type = f.type;
                while (type.kind !== Kind.NAMED_TYPE) {
                  if (type.kind === Kind.NON_NULL_TYPE) type = type.type;
                  if (type.kind === Kind.LIST_TYPE) type = type.type;
                }
                return type.name.value;
              }).filter((t) => inputs[t]) ?? [];
              if (subFieldTypes.some((t) => !handledInputs.has(t))) {
                stack.push(current);
                stack.push(...subFieldTypes);
                continue;
              }
              handledInputs.add(current);
            }
          },
        ).filter(Boolean)
      ).filter(filterOutputTypes),
      ...collection.flatMap((o) => {
        const name = operationDataName(o, operationType);

        const resolvedOperationType = getOperationType(
          o.definition,
          types,
          fragments,
          roots[o.definition.operation],
          references,
          includeTypenames,
        );

        const arr = [
          `${exports.includes("operations") ? "export " : ""}type ${name} = ${
            serializeType(
              resolvedOperationType,
              false,
              undefined,
            )
          };`,
        ];

        if (o.definition.variableDefinitions?.length) {
          arr.push(
            `${
              exports.includes("operations") ? "export " : ""
            }type ${name}Variables = ${
              serializeType(
                getOperationVariables(o.definition, references),
                true,
              )
            };`,
          );
        }

        return arr;
      }).filter(filterOutputTypes),
      ,
      `export type ${operationNames[operationType].types} = {
${
        collection.map((o) => {
          const name = operationDataName(o, operationType);
          return `  ${o.name}: { data: ${name};${
            o.definition.variableDefinitions?.length
              ? ` variables: ${name}Variables;`
              : ""
          } };`;
        }).join("\n")
      }
};

export const ${operationNames[operationType].list} = {
${
        collection.map((o) =>
          `  ${o.name}: "${relative(process.cwd(), o.path)}",`
        ).join("\n")
      }
};`,
    ]);

  if (handledInputs.size) {
    serializedTypes.unshift(
      ...(Array.from(handledInputs)).map((i) => {
        const def = inputs[i]?.[0];
        if (!def) throw new Error(`Could not find input '${i}'`);
        return `${exports.includes("types") ? "export " : ""}type ${i} = ${
          serializeType(
            serializeInput(def.fields ?? [], false, {}, references),
            true,
          )
        };`;
      }).filter(filterOutputTypes),
      `export type Inputs = {
${Array.from(handledInputs).map((i) => `  ${i}: ${rename(i)};`).join("\n")}
};`,
      `export const inputs = [${
        Array.from(handledInputs).map((i) => `"${i}"`).join(", ")
      }] as const;`,
    );
  }

  // console.log(types["Node"]);
  const usedTypes = Object.entries(types)
    .map((
      [name, info],
    ): [string, TypeDefinitionNode, Set<string>] => [name, ...info!])
    .filter((
      data,
    ): data is [
      string,
      | ObjectTypeDefinitionNode
      | UnionTypeDefinitionNode
      | InterfaceTypeDefinitionNode,
      Set<string>,
    ] =>
      (data[1].kind === "ObjectTypeDefinition" ||
        data[1].kind === "UnionTypeDefinition" ||
        data[1].kind === "InterfaceTypeDefinition") && data[2].size > 0
    );

  if (usedTypes.length) {
    serializedTypes.unshift(
      ...usedTypes.map(([name, type, usage]) =>
        `${exports.includes("types") ? "export " : ""}type ${name} = ${
          type.kind === "ObjectTypeDefinition"
            ? `{
${includeTypenames ? `  __typename: "${name}";\n` : ""}${
              type.fields?.filter((f) => usage.has(f.name.value)).map((v) =>
                `  ${v.name.value}: ${
                  serializeType(simpleType(v.type, types))
                };`
              ).join("\n")
            }
}`
            : type.kind === "UnionTypeDefinition"
            ? type.types?.map((t) => t.name.value).join(" | ")
            : usedTypes.filter(([, t]) =>
              t.kind === Kind.OBJECT_TYPE_DEFINITION &&
              t.interfaces?.some((i) => i.name.value === name)
            ).map(([name]) => name).join(" | ")
        };`
      ).filter(filterOutputTypes),
      `export type Types = {
${usedTypes.map(([name]) => `  ${name}: ${rename(name)};`).join("\n")}
};`,
      `export const types = {\n${
        usedTypes.map(([name, type, usage]) =>
          `  ${
            name.match(/^[$A-Za-z_][0-9A-Za-z_$]*$/) ? name : `"${name}"`
          }: ${
            type.kind === "ObjectTypeDefinition"
              ? `[${
                type.fields?.filter((f) => usage.has(f.name.value)).map((v) =>
                  `"${v.name.value}"`
                ).join(", ")
              }]`
              : "[]"
          }`
        ).join(",\n")
      },\n} as const;`,
    );
  }

  // Generate types for fragments
  const fragmentTypes = Object.entries(fragments).map(
    ([fragmentName, fragment]) => {
      const fragmentSelections = getSelectionsType(
        fragment.typeCondition.name.value,
        fragment.selectionSet.selections,
        types,
        fragments,
        references,
        includeTypenames,
      );

      // Check if fragment is on a union type by looking for grouped selections (inline fragments)
      const groupedSelections = new Map<
        string | undefined,
        [string, SerializableType][]
      >();

      for (const [name, type, group] of fragmentSelections) {
        if (!groupedSelections.has(group)) {
          groupedSelections.set(group, []);
        }
        groupedSelections.get(group)!.push([name, type]);
      }

      // If we have multiple groups, this is a union fragment
      const hasMultipleGroups = groupedSelections.size > 1 ||
        (groupedSelections.size === 1 && !groupedSelections.has(undefined));

      if (hasMultipleGroups) {
        // Generate discriminated union for union fragments
        const unionMembers: SerializableType[] = [];

        for (const [group, selections] of groupedSelections) {
          if (group) {
            // This is an inline fragment group - create an object type for it
            const memberFields = selections.reduce(
              (fields, [name, type]) => {
                fields[name] = type;
                return fields;
              },
              {} as Record<string, SerializableType>,
            );

            // Add __typename for the specific union member type
            if (includeTypenames) {
              Object.defineProperty(memberFields, "__typename", {
                enumerable: true,
                value: {
                  kind: "StringLiteral",
                  value: group.split(":")[0], // Handle nested groups
                  optional: false,
                },
              });
            }

            unionMembers.push({
              kind: "Object" as const,
              value: memberFields,
              optional: false,
            });
          } else {
            // Fields without group (shouldn't happen in union fragments, but handle gracefully)
            const sharedFields = selections.reduce(
              (fields, [name, type]) => {
                fields[name] = type;
                return fields;
              },
              {} as Record<string, SerializableType>,
            );

            if (Object.keys(sharedFields).length > 0) {
              unionMembers.push({
                kind: "Object" as const,
                value: sharedFields,
                optional: false,
              });
            }
          }
        }

        return [
          fragmentName,
          {
            kind: "Union" as const,
            value: unionMembers,
            optional: false,
          } as SerializableType,
          [...new Set(fragmentSelections.map(([name]) => name))],
        ] as const;
      } else {
        // Regular object fragment (not on union type)
        const fragmentFields = fragmentSelections.reduce(
          (fields, [name, type]) => {
            fields[name] = type;
            return fields;
          },
          {} as Record<string, SerializableType>,
        );

        // Add __typename for object types
        const baseTypeDef = types[fragment.typeCondition.name.value];
        if (
          includeTypenames && baseTypeDef?.[0].kind === "ObjectTypeDefinition"
        ) {
          Object.defineProperty(fragmentFields, "__typename", {
            enumerable: true,
            value: {
              kind: "StringLiteral",
              value: fragment.typeCondition.name.value,
              optional: false,
            },
          });
        }

        return [
          fragmentName,
          {
            kind: "Object" as const,
            value: fragmentFields,
            optional: false,
          } as SerializableType,
          [...new Set(fragmentSelections.map(([name]) => name))],
        ] as const;
      }
    },
  );

  if (fragmentTypes.length) {
    serializedTypes.unshift(
      ...fragmentTypes.map(([name, type, _fields]) =>
        `${exports.includes("types") ? "export " : ""}type ${name} = ${
          serializeType(type, false)
        };`
      ).filter(filterOutputTypes),
    );

    // Update Types export to include fragments
    const typesIndex = serializedTypes.findIndex((line) =>
      line?.startsWith("export type Types = {")
    );
    if (typesIndex !== -1) {
      const existingTypesExport = serializedTypes[typesIndex]!;
      const updatedTypesExport = existingTypesExport.replace(
        "export type Types = {",
        `export type Types = {
${fragmentTypes.map(([name]) => `  ${name}: ${name};`).join("\n")}${
          usedTypes.length ? "\n" : ""
        }`,
      );
      serializedTypes[typesIndex] = updatedTypesExport;
    }

    // Update types const export to include fragments
    const typesConstIndex = serializedTypes.findIndex((line) =>
      line?.startsWith("export const types = {")
    );
    if (typesConstIndex !== -1) {
      const existingTypesConstExport = serializedTypes[typesConstIndex]!;
      const fragmentTypesConst = fragmentTypes.map(([name, , fields]) =>
        `  ${name}: [${fields.map((f) => `"${f}"`).join(", ")}]`
      ).join(",\n");

      const updatedTypesConstExport = existingTypesConstExport.replace(
        "export const types = {",
        `export const types = {
${fragmentTypesConst}${usedTypes.length && fragmentTypes.length ? "," : ""}${
          usedTypes.length ? "\n" : ""
        }`,
      );
      serializedTypes[typesConstIndex] = updatedTypesConstExport;
    }
  }

  const usedReferences = Object.values(references).filter((r) => r[1]).map(
    (r) => r[0],
  );
  serializedTypes.unshift(
    ...usedReferences.map((r) => {
      // TODO: warn if missing and use unknown instead
      if (r.kind === "ScalarTypeDefinition") {
        return `${
          exports.includes("types") ? "export " : ""
        }type ${r.name.value} = ${
          scalars[r.name.value] ??
            raise(`Could not find scalar '${r.name.value}'`)
        };`;
      }
      if (enums === "enums") {
        return `${
          exports.includes("types") ? "export " : ""
        }enum ${r.name.value} {
  ${r.values?.map((r) => r.name.value).join(",\n  ")},
}`;
      } else if (enums === "literals") {
        return `${
          exports.includes("types") ? "export " : ""
        }type ${r.name.value} = ${
          r.values?.map((r) => `"${r.name.value}"`).join(" | ")
        };`;
      }
    }).filter(filterOutputTypes),
  );

  if (typesFile) {
    const operationsImports = (operations: Operation[]) =>
      operations.flatMap((o) => {
        const prefix = operationDataName(o, o.definition.operation);
        return o.definition.variableDefinitions?.length
          ? [`${prefix}`, `${prefix}Variables`]
          : `${prefix}`;
      });
    const imports = [
      ...operationsImports(operations.query),
      ...operationsImports(operations.mutation),
      ...operationsImports(operations.subscription),
      ...usedTypes.map((u) => rename(u[0])),
      ...Array.from(handledInputs, (i) => rename(i)),
    ];
    serializedTypes.unshift(
      `import {\n  ${imports.sort().join(",\n  ")},
} from "${typesFile}";`,
    );
  } else if (
    enums.startsWith("import:") &&
    usedReferences.some((r) => r.kind === Kind.ENUM_TYPE_DEFINITION)
  ) {
    serializedTypes.unshift(
      `import {
  ${
        usedReferences.filter((r) => r.kind === Kind.ENUM_TYPE_DEFINITION).map(
          (r) => r.name.value,
        ).join(",\n  ")
      },
} from "${enums.slice(7)}";`,
    );
  }

  return serializedTypes.join("\n\n") + "\n";
};

export const loadFiles = async (
  schemaPath: string,
  operationDirs: string[],
): Promise<
  [schema: string, operations: { path: string; content: string }[]]
> => {
  const operationPromises: Promise<{ path: string; content: string }>[] = [];
  for (const dir of operationDirs) {
    for await (const path of fg.stream(join(dir, "**/*.gql"))) {
      operationPromises.push(
        readFile(path.toString(), "utf-8").then((content) => ({
          path: path.toString(),
          content,
        })),
      );
    }
  }
  return [
    await readFile(schemaPath, "utf-8"),
    (await Promise.all(operationPromises)).sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
  ];
};
