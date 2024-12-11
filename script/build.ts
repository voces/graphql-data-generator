import config from "../deno.json" with { type: "json" };
import { build, emptyDir } from "jsr:@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./src/index.ts", {
    kind: "bin",
    name: "graphql-data-generator",
    path: "./src/cli.ts",
  }, {
    kind: "export",
    name: "./plugin",
    path: "./src/plugin.cjs",
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
    "npm:@graphql-tools/graphql-tag-pluck": {
      name: "@graphql-tools/graphql-tag-pluck",
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

    if (!pkg.peerDependencies) pkg.peerDependencies = {};

    const prevGraphql = pkg.dependencies.graphql;
    delete pkg.dependencies.graphql;
    pkg.peerDependencies.graphql = prevGraphql;

    const prevGqlPluck = pkg.dependencies["@graphql-tools/graphql-tag-pluck"];
    delete pkg.dependencies["@graphql-tools/graphql-tag-pluck"];
    pkg.peerDependencies["@graphql-tools/graphql-tag-pluck"] = prevGqlPluck;

    for (const key in pkg.exports) {
      pkg.exports[key] = {
        import: pkg.exports[key].import.default,
        require: pkg.exports[key].import.default,
        types: pkg.exports[key].import.types,
        default: pkg.exports[key].import.default,
      };
    }
    await Deno.writeTextFile("npm/package.json", JSON.stringify(pkg, null, 2));
  },
});
