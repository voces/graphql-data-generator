import config from "../deno.json" with { type: "json" };
import { build, emptyDir } from "jsr:@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: [{
    kind: "bin",
    name: "graphql-data-generator",
    path: "./src/cli.ts",
  }, "./src/index.ts"],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  scriptModule: false,
  skipSourceOutput: true,
  package: {
    name: "graphql-data-generator",
    version: config.version,
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/vocesgraphql-data-generator/.git",
    },
    bugs: {
      url: "https://github.com/voces/graphql-data-generator/issues",
    },
    type: "module",
  },
  postBuild() {
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
