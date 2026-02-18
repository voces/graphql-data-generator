import { afterEach } from "jsr:@std/testing/bdd";

// deno-lint-ignore no-explicit-any
globalThis.afterEach = afterEach as any;

// deno-lint-ignore no-explicit-any
(globalThis as any).expect = {
  getState: () => ({
    assertionCalls: 0,
    numPassingAsserts: 0,
    suppressedErrors: [],
  }),
};

if (!globalThis.jest) globalThis.jest = {} as typeof jest;
if (!globalThis.jest.fn) {
  // deno-lint-ignore no-explicit-any
  globalThis.jest.fn = (<T, Y extends any[]>(impl: (...args: Y) => T) => {
    const mock: { calls: Y[] } = { calls: [] };
    return Object.assign(
      (...args: Y) => {
        mock.calls.push(args);
        return impl(...args);
      },
      { mock },
    );
  }) as typeof jest["fn"];
}

const graphqlTagPaths = [
  `${
    Deno.env.get("HOME")
  }/.cache/deno/npm/registry.npmjs.org/graphql-tag/2.12.6/package.json`,
  `${
    Deno.env.get("HOME")
  }/Library/Caches/deno/npm/registry.npmjs.org/graphql-tag/2.12.6/package.json`,
];

for (const path of graphqlTagPaths) {
  try {
    const packageJson = JSON.parse(await Deno.readTextFile(path));

    if (packageJson.main !== "./lib/index.js") {
      packageJson.main = "./lib/index.js"; // Fix the main entry

      await Deno.writeTextFile(path, JSON.stringify(packageJson, null, 2));

      console.log("Patched graphql-tag package.json successfully.");
    }
  } catch { /** do nothing */ }
}
