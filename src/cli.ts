import { readFile } from "node:fs";
import fg from "npm:fast-glob";
import { parseArgs } from "node:util";
import { codegen, loadFiles } from "./codegen.ts";
import { formatCode } from "./util.ts";
import process from "node:process";

const args = parseArgs(
  {
    args: process.argv.slice(2),
    options: {
      schema: { type: "string" },
      scalars: { type: "string" },
      operations: { type: "string", multiple: true },
      scalar: { type: "string", multiple: true },
      outfile: { type: "string" },
      useEnums: { type: "boolean", default: false },
      includeTypenames: { type: "boolean", default: true },
    },
  },
).values;

const findFirst = async (path: string) => {
  for await (const file of fg.stream(path)) {
    return file.toString();
  }
};

const schemaPath = args.schema
  ? await findFirst(args.schema)
  : (await findFirst("**/schema.graphql") ??
    await findFirst("**/schema.gql") ??
    await findFirst("**/schema.graphqls"));

const fail = (reason: unknown, code = 1): never => {
  process.stderr.write(reason + "\n");
  process.exit(code);
};

if (!schemaPath) {
  fail(
    `Could not locate schema${
      args.schema ? ` "${args.schema}"` : ", try passing --schema"
    }`,
  );
  throw ""; // TS being dumb?
}

const operationDirs = args.operations?.map((v) => `${v}`) ?? ["."];

const [schema, operations] = await loadFiles(schemaPath, operationDirs);

const defaultScalars = {
  Int: "number",
  Float: "number",
  String: "string",
  Boolean: "boolean",
  ID: "string",
};

const scalars: Record<string, string> = { ...defaultScalars };
if (args.scalars) {
  readFile;
  Object.assign(scalars, JSON.parse(await Deno.readTextFile(args.scalars)));
}

if (args.scalar) {
  for (const kv of args.scalar) {
    const [key, value] = `${kv}`.split(":");
    if (!value) {
      fail(
        "Invalid --scalar argument. Pass as a key-value pair like --scalar=key:value",
      );
    }
    scalars[key] = value;
  }
}

try {
  const file = await formatCode(codegen(schema, operations, {
    useEnums: args.useEnums,
    includeTypenames: args.includeTypenames,
    scalars,
  }));

  if (args.outfile) await Deno.writeTextFile(args.outfile, file);
  else console.log(file);
} catch (err) {
  const message = err instanceof Error ? err.message : `${err}`;
  if (message.startsWith("Could not find scalar")) {
    const scalar = message.match(/'([^']*)'/)?.[1];
    fail(
      `${message}. Try passing --scalars=scalars.json or --scalar=${
        scalar ?? "scalar"
      }:string, replacing string with the TypeScript type of the scalar.`,
    );
  }
  fail(err instanceof Error ? err.message : err);
}
