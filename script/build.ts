import config from "../deno.json" with { type: "json" };
import { build, emptyDir } from "jsr:@deno/dnt";

await emptyDir("./npm");

const markPeerDependency = (
  pkg: {
    peerDependencies?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  },
  dependency: string,
) => {
  if (!pkg || typeof pkg !== "object" || !pkg.dependencies) return;

  if (!pkg.peerDependencies) pkg.peerDependencies = {};

  const prev = pkg.dependencies[dependency];
  if (!prev) return;
  delete pkg.dependencies[dependency];
  pkg.peerDependencies[dependency] = prev;
};

await build({
  entryPoints: ["./src/index.ts", {
    kind: "bin",
    name: "graphql-data-generator",
    path: "./src/cli.ts",
  }, {
    kind: "export",
    name: "./plugin",
    path: "./src/plugin.cjs",
  }, {
    kind: "export",
    name: "./jest",
    path: "./src/jest.tsx",
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
    "npm:react": {
      name: "react",
      peerDependency: true,
    },
    "npm:@apollo/client": {
      name: "@apollo/client",
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
      url: "git+https://github.com/voces/graphql-data-generator.git",
    },
    bugs: {
      url: "https://github.com/voces/graphql-data-generator/issues",
    },
  },
  async postBuild() {
    Deno.copyFileSync("README.md", "npm/README.md");
    const pkg = JSON.parse(await Deno.readTextFile("npm/package.json"));

    if (!pkg.peerDependencies) pkg.peerDependencies = {};

    for (
      const dep of [
        "graphql",
        "@graphql-tools/graphql-tag-pluck",
        "react",
        "@types/react",
        "@apollo/client",
      ]
    ) {
      markPeerDependency(pkg, dep);
    }

    if (!pkg.peerDependenciesMeta) pkg.peerDependenciesMeta = {};
    pkg.peerDependenciesMeta.react = { optional: true };
    pkg.peerDependenciesMeta["@types/react"] = { optional: true };
    pkg.peerDependenciesMeta["@apollo/client"] = { optional: true };

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
