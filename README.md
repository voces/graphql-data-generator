# graphql-data-generator

graphql-data-generator is a testing utility for generating GraphQL data objects
and operation mocks from your schema. It simplifies test setup by combining
generated types, patching mechanisms, and customizable **transforms** for common
object variations. It also includes helpers for asserting mock coverage in
tests.

- [Example](#example-setting-up-a-builder-and-building-objects)
- [CLI options](#cli-options)
- [@graphql-codegen plugin](#graphql-codegen-plugin)
- [Patches](#patches)
- [Transforms](#transforms)
- [Testing](#testing)
- [Extra properties](#extra)

### Key Concepts

- **Patch:** Like a `DeepPartial`, but with functions and array helpers.
- **Transform:** Predefined reusable patches.
- **MockedProvider:** A helper that wraps `@apollo/client`'s `MockedProvider`
  with built-in assertions and better stack traces.

## Example: Setting up a builder and building objects

### Step 1: Generating types

To use `graphql-data-generator` with TypeScript, you must pregenerated some a
types file. This file can optionally include your entire schema types, but at
minimal includes an index of types, inputs, and operations. You can generated
the types via the following CLI command or by plugging `@graphql-codegen` (see
docs).

```sh
npx graphql-data-generator --schema src/graphql/schema.graphql --outfile src/util/test/types.ts
```

Then consume these types and initialize a builder:

```ts
import { readFileSync } from "node:fs";
import { init, Patch } from "npm:graphql-data-generator";
import {
  Inputs,
  inputs,
  Mutation,
  mutations,
  queries,
  Query,
  Subscription,
  subscriptions,
  Types,
  types,
} from "./types.ts";

const schema = readFileSync("graphql/schema.graphql", "utf-8");

const scalars = {
  ID: (typename) => `${typename.toLowerCase()}-0`,
  String: "",
};

export const build = init<Query, Mutation, Subscription, Types, Inputs>(
  schema,
  queries,
  mutations,
  subscriptions,
  types,
  inputs,
  scalars,
)(() => ({
  // Can define transforms for objects
  User: {
    // `default` automatically applies to all User objects
    default: { profilePicture: (u) => `https://example.com/${u.id}.png` },
    // Can invoke with `build.User.withPost()` or `build.User().withPost()`
    withPost: (_p, post: Patch<Types["Post"]> = {}) => ({
      posts: { next: post },
    }),
  },
  // Can define transforms for operations
  CreatePost: {
    withAuthorId: (_, authorId: string) => ({
      variables: { input: { authorId } },
      data: { createPost: { author: { id: authorId } } },
    }),
  },
}));
```

After which you can build objects and operations in your tests:

```ts
import { build } from "util/tests/build.ts";

const user1 = build.User().withPost();
// Can override properties
const user2 = build.User({ id: "user-2", email: (u) => u.email + "2" });
// `patch` is a built-in transform while `withPost` was defined above
const user3 = user1.patch({
  id: "user-3",
  // `last` is special property for arrays to modify the last element in the array. If one does not exist it is created
  // `next` is a special property for arrays to append a new item to the array
  posts: { last: { author: { id: "user-3" } }, next: {} },
});

const createPost = build.CreatePost({ data: { createPost: { id: "post-id" } } })
  .withAuthorId("user-3");
```

## CLI options

| Option             | Value                                               | Description                                                                                                            |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `banner`           | `<filepath>` or `<string>`                          | Places copy at the beginning of the generated output.                                                                  |
| `enums`            | `enums`, `literals`, `none`, or `import:<filepath>` | Controls how enums are generated.                                                                                      |
| `exports`          | `operations` or `types`                             | Toggles exporting operations and/or types.                                                                             |
| `namingConvention` | `NamingConvention`                                  | Sets the [naming convention](https://the-guild.dev/graphql/codegen/docs/config-reference/naming-convention) for types. |
| `notypenames`      |                                                     | Disables automatic inclusion of `__typename`.                                                                          |
| `operations`       | `<dir>`                                             | Limits operation generation to a directory (repeatable).                                                               |
| `outfile`          | `<file>`                                            | Writes output to `file` instead of stdout.                                                                             |
| `scalar`           | `<Scalar>:<Type>`                                   | Maps a scalar to a TypeScript type.                                                                                    |
| `scalars`          | `<json filepath>`                                   | Maps scalars from a JSON file.                                                                                         |
| `schema`           | `<filepath>`                                        | Specifies the schema file to use.                                                                                      |
| `typesFile`        | `<filepath>`                                        | Uses types generated by [`@graphql-codegen`](https://the-guild.dev/graphql/codegen) instead of generating them here.   |

## @graphql-codegen plugin

A plugin shim exists for
[`@graphql-codegen`](https://the-guild.dev/graphql/codegen):

```ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "src/schema.graphql",
  documents: ["src/**/*.gql", "src/**/*.ts"],
  generates: {
    "./src/graphql/": {
      preset: "client",
      config: {
        scalars: {
          DateTime: "string",
          URL: "string",
        },
      },
    },
    "./src/build/generated.ts": {
      plugins: ["graphql-data-generator/plugin"],
      config: {
        typesFile: "../graphql/graphql.js",
        scalars: {
          DateTime: "string",
          URL: "string",
        },
        banner: "// generated\n",
      },
    },
  },
};

export default config;
```

Specifying a `typesFile` will skip outputting generated types and will instead
depend on the types generated by `@graphql-codegen` itself. The `generated.ts`
file can then be consumed by a `build` script similar to the above example.

## Patches

A `patch` is similar to a `DeepPartial` with a few extensions. First, functions
can be passed instead of literal properties. These functions will be invoked
during instantiation and will receive the previous host value as a property:

```ts
type Thing = { foo: string };
type ThingPatch = Patch<Thing>;
// Can exclude properties
const patch1: ThingPatch = {};
// Can specify them
const patch2: ThingPatch = { foo: "ok" };
// undefined will be ignored
const patch3: ThingPatch = { foo: undefined };
// Can use a function for more dynamic values
const patch4: ThingPatch = { foo: (prev: Thing) => `${prev.foo}2` };
```

### Arrays

`Patch` also has added semantics for arrays, including an object notation:

```ts
type Container = { values: string[] };
type ContainerPatch = Patch<Container>;
// Directly set index 1
const patch1: ContainerPatch = { values: { 1: "ok" } };
// `last` will modify the last element in the array. If the array is empty,
// instantiates a new element.
const patch2: ContainerPatch = { values: { last: "ok" } };
// `next` instantiates a new element and appends it to the array.
const patch3: ContainerPatch = { values: { next: "ok" } };
// `length` can be used to truncate or instantiate new elements
const patch4: ContainerPatch = { values: { length: 0 } };
// An array can be directly used. Will truncate extra elements.
const patch5: ContainerPatch = { values: ["ok"] };
```

### `clear`

In rare circumstances, you may want to patch a nullable array input field back
to `undefined`. Since `undefined` is purposefully ignored as a patch value and
`null` is semantically different, the `clear` value exported from
`graphql-data-generator` can be used revert the field back to `undefined`.

## Transforms

Transforms make it easy to define reusable **patches** for objects and
operations. For example, if you frequently need to build a User with a post, or
a `CreatePost` mutation with a pre-filled author, you can encode that logic into
a transform like `withPost` or `withAuthorId`. This keeps your test setup
concise and consistent. There are several built in transforms:

Objects:

- `default`: A special transform that is automatically called for all
  instantiations
- `patch`: Accepts a list of patches

Operations:

- `patch`: Accepts a list of patches
- `variables`: Accepts an operation variable patch. Useful as an alternative to
  `patch` if you don't need to specify `data`
- `data`: Accepts an operation data patch. Useful as an alternative to `patch`
  if you don't need to specify `variables`

When defining custom transforms, the `default` transform has special meaning: it
will be automatically applied as the first patch to all instances.

## Testing

`graphql-data-generator` also provides test utilities that work seamlessly with
`@apollo/client` and `@testing-library/react`. These helpers ensure all GraphQL
requests are properly mocked and all mocks are fully consumed.

```ts
import { MockedProvider, waitForMocks } from "graphql-data-generator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { build } from "util/tests/build.ts";

import Users from ".";

it("my test", async () => {
  render(<Users />, {
    wrapper: ({ children }) => (
      <MockedProvider
        mocks={[
          build.users({ data: { users: [{ id: "user-0", name: "User 0" }] } }),
          build.user({ variables: { id: "user-0" } }),
        ]}
        stack={new Error("Render").stack} // Useful if render is wrapped
      >
        {children}
      </MockedProvider>
    ),
  });
  await waitForMocks("users");
  await userEvent.click(screen.getByText("User 0"));
});
```

The `stack` property of `MockedProvider` will be appended to errors in which
mocks are missing, uncalled, or have mismatched variables.

When transitioning to using `graphql-data-generator`'s `MockedProvider`, it may
be helpful to disable asserting all requests are mocked. A helper,
`allowMissingMocks`, exists to disable these assertions and can be called before
any tests.

### Issues

#### Refetch warnings

If you are using an old version of `@apollo/client`, missing refetch requests
will emit warnings instead of errors. You can use `failRefetchWarnings` to
convert these warnings to errors.

#### Early unmounts

`@testing-library/react` automatically registers an `afterEach` hook to clean up
the DOM after each test. Similarly, `graphql-data-generator` adds its own
`afterEach` hook to verify that all mocks are consumed by the end of the test.

This can lead to unexpected errors or noisy logs if the DOM is unmounted before
`graphql-data-generator` runs its checks.

To avoid this, `graphql-data-generator` disables `@testing-library/react`'s
cleanup by default — **but only if it is loaded first**. If you can’t guarantee
the load order, you should manually disable the automatic cleanup:

```ts
import "npm:@testing-library/react/dont-cleanup-after-each";
```

If instead you want to disable `graphql-data-generator`'s cleanup behavior,
call:

```ts
import { skipCleanupAfterEach } from "graphql-data-generator";
```

## Extra

The `init` function supports a 6th optional generic parameter, `Extra`, which
allows defining extra properties for operation mocks, passable in operation
patches. This is helpful to support extra Apollo-related properties or custom
logic. Extra properties will always be optional in patches and the final object
and will not be patched in but simply merged, such as by `Object.assign`.

### Example: Adding an extra property for your own use

```ts
const build = init<
  Query,
  Mutation,
  Subscription,
  Types,
  Inputs,
  { internal: boolean }
>(
  schema,
  queries,
  mutations,
  subscriptions,
  types,
  inputs,
  scalars,
)(() => ({}));

build.CreatePost({ internal: true }).internal; // true
```
