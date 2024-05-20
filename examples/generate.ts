import { expandGlob } from "jsr:@std/fs/expand-glob";
import { join, relative } from "jsr:@std/path@^0.225.1";
import { codegen } from "../src/codegen.ts";
import { formatCode } from "../src/util.ts";

const examples: Promise<void>[] = [];

const generate = async (dir: string) => {
  const schemaPromise = Deno.readTextFile(join(dir, "schema.graphql"));
  const operationPromises: Promise<{ path: string; content: string }>[] = [];
  for await (const { path } of expandGlob(join(dir, "**/*.gql"))) {
    // if (!path.endsWith("GetNode.gql")) continue;
    operationPromises.push(
      Deno.readTextFile(path).then((content) => ({
        path: relative(Deno.cwd(), path),
        content,
      })),
    );
  }

  await Deno.writeTextFile(
    join(dir, "types.ts"),
    await formatCode(
      codegen(await schemaPromise, await Promise.all(operationPromises), {
        useEnums: false,
        includeTypenames: true,
        scalars: {
          Int: "number",
          Float: "number",
          String: "string",
          Boolean: "boolean",
          ID: "string",
          DateTime: "string",
          URL: "string",
        },
      }),
    ),
  );
};

for await (const entry of Deno.readDir("examples")) {
  if (!entry.isDirectory) continue;

  examples.push(generate(join("examples", entry.name)));
}

await Promise.all(examples);
