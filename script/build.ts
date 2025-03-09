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

const optionalPeerDependencies = [
  "react",
  "@types/react",
  "@apollo/client",
  "@testing-library/dom",
  "@testing-library/react",
];
const peerDependencies = [
  "graphql",
  "@graphql-tools/graphql-tag-pluck",
  ...optionalPeerDependencies,
];

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
  skipSourceOutput: true,
  test: false,
  declaration: "separate",
  mappings: Object.fromEntries(
    optionalPeerDependencies.map(
      (dep) => [`npm:${dep}`, { name: dep, markPeerDependency: true }],
    ),
  ),
  package: {
    name: "graphql-data-generator",
    version: config.version,
    license: "MIT",
    typesVersions: {
      "*": {
        "script/jest": ["types/jest.d.ts"],
        "script/plugin": ["types/plugin.d.ts"],
      },
    },
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

    for (const dep of peerDependencies) markPeerDependency(pkg, dep);

    if (!pkg.peerDependenciesMeta) pkg.peerDependenciesMeta = {};
    for (const dep of optionalPeerDependencies) {
      pkg.peerDependenciesMeta[dep] = { optional: true };
    }

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
