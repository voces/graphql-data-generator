import {
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  FragmentDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  OperationDefinitionNode,
  parse,
  ScalarTypeDefinitionNode,
  SelectionNode,
  TypeDefinitionNode,
} from "npm:graphql";
import { raise } from "./util.ts";

type SerializableType =
  | { kind: "Name"; value: string; optional: boolean }
  | { kind: "List"; value: SerializableType; optional: boolean }
  | {
    kind: "Object";
    value: Record<string, SerializableType>;
    conditionals?: SerializableType[];
    optional: boolean;
  }
  | { kind: "StringLiteral"; value: string; optional: boolean };

const getType = (
  { type, ...props }: {
    type: NamedTypeNode | ListTypeNode | NonNullTypeNode;
    optional?: boolean;
    selections?: readonly SelectionNode[];
    definitions: Record<string, TypeDefinitionNode | undefined>;
    fragments: Record<string, FragmentDefinitionNode | undefined>;
    references: Record<string, [TypeDefinitionNode, boolean] | undefined>;
    includeTypenames: boolean;
  },
): SerializableType => {
  if (type.kind === "NamedType") {
    if (props.selections) {
      const groupedValues = getSelectionsType(
        type.name.value,
        props.selections,
        props.definitions,
        props.fragments,
        props.references,
        props.includeTypenames,
      ).reduce((union, [name, value, group]) => {
        group ??= type.name.value;
        if (!union[group]) {
          union[group] = {};
          if (
            props.includeTypenames &&
            props.definitions[group]?.kind === "ObjectTypeDefinition"
          ) {
            union[group].__typename = {
              kind: "StringLiteral",
              value: group,
              optional: false,
            };
          }
        }
        union[group]![name] = value;
        return union;
      }, {} as Record<string, Record<string, SerializableType>>);

      const value = groupedValues[type.name.value] ?? {};
      delete groupedValues[type.name.value];

      return {
        kind: "Object",
        value,
        conditionals: Object.values(groupedValues).map((value) => ({
          kind: "Object",
          value,
          optional: false,
        })),
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

type SelectionType = [name: string, type: SerializableType, group?: string];
const getSelectionsType = (
  name: string,
  selections: readonly SelectionNode[],
  definitions: Record<string, TypeDefinitionNode | undefined>,
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
          throw new Error(`Could not find type '${selection.name.value}'`);
        }

        switch (selectionType.kind) {
          case "ObjectTypeDefinition":
          case "InterfaceTypeDefinition": {
            const fieldType = selectionType.fields?.find((f) =>
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
            ]);

            break;
          }
          case "UnionTypeDefinition": {
            const types = selectionType.types;
            if (!types) {
              throw new Error(
                `Expected types to be present on union '${selectionType.name.value}'`,
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
            throw new Error(`Unhandled selection type '${selectionType.kind}'`);
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
              [n, t, g],
              // Test: nested fragments?
            ): SelectionType => [n, t, g ? `${group}:${g}` : group])
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
        selectionTypes.push(
          ...getSelectionsType(
            fragment.typeCondition.name.value,
            fragment.selectionSet.selections,
            definitions,
            fragments,
            references,
            includeTypenames,
          ),
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
  definitions: Record<string, TypeDefinitionNode | undefined>,
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

const serializeType = (type: SerializableType): string => {
  switch (type.kind) {
    case "Name":
      return `${type.value}${type.optional ? " | null" : ""}`;
    case "List":
      if (
        type.value.optional ||
        (type.value.kind === "Object" && type.value.conditionals?.length)
      ) {
        return `(${serializeType(type.value)})[]${
          type.optional ? " | null" : ""
        }`;
      }
      return `${serializeType(type.value)}[]${type.optional ? " | null" : ""}`;
    case "Object":
      return `${
        [
          `{${
            Object.entries(type.value).map(([key, value]) =>
              `${key}: ${serializeType(value)}`
            ).join(", ")
          }}`,
          ...(type.conditionals?.map((c) => `(${serializeType(c)} | {})`) ??
            []),
        ].filter(Boolean).join(" & ")
      }${type.optional ? " | null" : ""}`;
    case "StringLiteral":
      return `"${type.value}"`;
  }
};

const serializeInput = (
  fields: readonly InputValueDefinitionNode[],
  optional: boolean,
  inputs: Record<string, InputObjectTypeDefinitionNode | undefined>,
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
  inputs: Record<string, InputObjectTypeDefinitionNode | undefined>,
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
        def.fields ?? [],
        input.optional,
        inputs,
        references,
      );
    }
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
  query: { types: "Queries", list: "queries" },
  mutation: { types: "Mutations", list: "mutations" },
  subscription: { types: "Subscriptions", list: "subscriptions" },
};

export const codegen = (
  schema: string,
  files: { path: string; content: string }[],
  { useEnums = true, scalars = {}, includeTypenames = true }: {
    useEnums?: boolean;
    scalars?: Record<string, string | undefined>;
    includeTypenames?: boolean;
  } = {},
) => {
  const schemaDom = parse(schema);

  const types: Record<
    string,
    ObjectTypeDefinitionNode | TypeDefinitionNode | undefined
  > = {};
  const inputs: Record<string, InputObjectTypeDefinitionNode | undefined> = {};
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

  for (const definition of schemaDom.definitions) {
    switch (definition.kind) {
      case "ObjectTypeDefinition":
        if (definition.name.value === "Query") {
          query = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else if (definition.name.value === "Mutation") {
          mutation = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else if (definition.name.value === "Subscription") {
          subscription = Object.fromEntries(
            definition.fields?.map((f) => [f.name.value, f] as const) ?? [],
          );
        } else types[definition.name.value] = definition;
        break;
      case "InputObjectTypeDefinition":
        inputs[definition.name.value] = definition;
        break;
      case "InterfaceTypeDefinition":
        types[definition.name.value] = definition;
        break;
      case "UnionTypeDefinition": {
        const prev = types[definition.name.value];
        if (prev?.kind === "UnionTypeDefinition") {
          types[definition.name.value] = {
            ...prev,
            types: [...(prev.types ?? []), ...(definition.types ?? [])],
          };
        } else types[definition.name.value] = definition;
        break;
      }
      case "EnumTypeDefinition":
      case "ScalarTypeDefinition":
        references[definition.name.value] = [definition, false];
        break;
      default:
        throw new Error(`Unhandled definition type '${definition.kind}'`);
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

  const handledInputs = new Set<string>();

  const serializedTypes = Object.entries(operations).filter(([, v]) => v.length)
    .flatMap((
      [name, collection],
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

            if (handledInputs.has(type.value)) return;

            return `type ${type.value} = ${serializeType(inputType)};`;
          },
        ).filter(Boolean)
      ),
      `export type ${operationNames[name].types} = {
${
        collection.map((o) => {
          const data = serializeType(getOperationType(
            o.definition,
            types,
            fragments,
            roots[o.definition.operation],
            references,
            includeTypenames,
          ));
          const variables = getOperationVariables(o.definition, references);

          return `  ${o.name}: {
    data: ${data};${
            variables.kind === "Object" && Object.keys(variables.value).length
              ? `
    variables: ${serializeType(variables)};`
              : ""
          }
  };`;
        }).join("\n")
      }
};

export const ${operationNames[name].list} = {
${collection.map((o) => `  ${o.name}: "${o.path}",`).join("\n")}
};`,
    ]);

  const usedReferences = Object.values(references).filter((r) => r[1]).map(
    (r) => r[0],
  );
  if (usedReferences.length) {
    serializedTypes.unshift(
      ...usedReferences.map((r) => {
        if (r.kind === "ScalarTypeDefinition") {
          return `type ${r.name.value} = ${
            scalars[r.name.value] ??
              raise(`Could not find scalar '${r.name.value}'`)
          };`;
        }
        if (useEnums) {
          return `enum ${r.name.value} {
  ${r.values?.map((r) => r.name.value).join(",\n")}
}`;
        } else {
          return `type ${r.name.value} = ${
            r.values?.map((r) => `"${r.name.value}"`).join(" | ")
          };`;
        }
      }),
    );
  }

  return serializedTypes.join("\n\n");
};