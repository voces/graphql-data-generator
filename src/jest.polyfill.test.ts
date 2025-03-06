import { afterEach, beforeEach } from "jsr:@std/testing/bdd";

// deno-lint-ignore no-explicit-any
globalThis.afterEach = afterEach as any;

declare namespace jasmine {
  type CustomReporterResult = {
    failedExpectations: unknown[];
  };

  const getEnv: () => {
    addReporter: (
      props: { specStarted: (result: jasmine.CustomReporterResult) => void },
    ) => void;
  };
}

const reporters: ((result: unknown) => void)[] = [];
beforeEach(() => {
  const result = { failedExpectations: [] };
  for (const reporter of reporters) reporter(result);
});
globalThis.jasmine = {
  // @ts-ignore Declared it
  getEnv: () => ({
    addReporter: (
      { specStarted }: { specStarted: (result: unknown) => void },
    ) => reporters.push(specStarted),
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

const path = `${
  Deno.env.get("HOME")
}/Library/Caches/deno/npm/registry.npmjs.org/graphql-tag/2.12.6/package.json`;
const packageJson = JSON.parse(await Deno.readTextFile(path));

if (packageJson.main !== "./lib/index.js") {
  packageJson.main = "./lib/index.js"; // Fix the main entry

  await Deno.writeTextFile(path, JSON.stringify(packageJson, null, 2));

  console.log("Patched graphql-tag package.json successfully.");
}

let _fail: unknown;
globalThis.fail = (error) => {
  _fail = error instanceof Error ? error : Object.assign(new Error(), error);
  throw error;
};

afterEach(() => {
  if (_fail) {
    const error = _fail;
    _fail = undefined;
    throw error;
  }
});
