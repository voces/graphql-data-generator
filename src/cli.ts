import { readFile } from "node:fs";
import fg from "npm:fast-glob";
import { parseArgs } from "node:util";
import { codegen, loadFiles } from "./codegen.ts";
import { formatCode } from "./util.ts";
import process from "node:process";

(async () => {
  const args = parseArgs(
    {
      args: process.argv.slice(2),
      options: {
        banner: { type: "string" },
        enums: { type: "string" },
        exports: { type: "string", multiple: true },
        namingConvention: { type: "string" },
        notypenames: { type: "boolean" },
        operations: { type: "string", multiple: true },
        outfile: { type: "string" },
        scalar: { type: "string", multiple: true },
        scalars: { type: "string" },
        schema: { type: "string" },
        typesFile: { type: "string" },
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

  const scalars: Record<string, string> = {};
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

  const validExports = ["operations", "types"] as const;
  const exports = args.exports
    ? args.exports.filter((e): e is typeof validExports[number] => {
      if (!validExports.includes(e as typeof validExports[number])) {
        throw new Error(`Invalid export. Must be ${validExports.join(", ")}`);
      }
      return true;
    })
    : [];

  if (
    typeof args.enums === "string" &&
    (!["enums", "literals", "none"].includes(args.enums) &&
      !args.enums.startsWith("import:"))
  ) {
    throw new Error(
      `Invalid 'enums'. Must be one of 'enums', 'literals', 'import', 'none'`,
    );
  }

  let banner = "";
  if (typeof args.banner === "string") {
    if (await Deno.lstat(args.banner).catch(() => false)) {
      banner = await Deno.readTextFile(args.banner);
    } else banner = args.banner;
  }

  try {
    const file = banner + await formatCode(codegen(schema, operations, {
      enums: args.enums,
      includeTypenames: !args.notypenames,
      scalars,
      exports,
      typesFile: args.typesFile,
      namingConvention: args.namingConvention,
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
})();
