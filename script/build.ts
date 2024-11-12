import config from "../deno.json" with { type: "json" };
import { build, emptyDir } from "jsr:@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./src/index.ts", {
    kind: "bin",
    name: "graphql-data-generator",
    path: "./src/cli.ts",
  }],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  scriptModule: false,
  skipSourceOutput: true,
  test: false,
  declaration: "separate",
  mappings: {
    "npm:graphql": {
      name: "graphql",
      peerDependency: true,
    },
  },
  package: {
    name: "graphql-data-generator",
    version: config.version,
    license: "MIT",
    main: "./esm/index.js",
    repository: {
      type: "git",
      url: "git+https://github.com/vocesgraphql-data-generator/.git",
    },
    bugs: {
      url: "https://github.com/voces/graphql-data-generator/issues",
    },
  },
  async postBuild() {
    Deno.copyFileSync("README.md", "npm/README.md");
    const pkg = JSON.parse(await Deno.readTextFile("npm/package.json"));
    const prev = pkg.dependencies.graphql;
    delete pkg.dependencies.graphql;
    if (!pkg.peerDependencies) pkg.peerDependencies = {};
    pkg.peerDependencies.graphql = prev;
    await Deno.writeTextFile("npm/package.json", JSON.stringify(pkg, null, 2));
  },
});
