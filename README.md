# graphql-data-generator

A tool to generate objects and operation mocks from a GraphQL schema. Allows
defining _transforms_ to simplify common variations.

## Example

First generate types and type lists:

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
  scalarss,
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

## Patches

A `patch` is similar to a `DeepPartial` with a few extensions. First, functions
can be passed instead of literal properties. These functions will be invoked
during instantiation and will receieve the previous host value as a property:

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

## Transforms

`graphql-data-generator` creates objects and operations by applying **patches**
in sequence. A **patch** is similar to a `DeepPartial`, but supports functions
for each property and has . Transforms are a mechanism to define shorthands for
common patches for particular objects or operations. There are several built in
transforms:

Objects:

- `default`: A special transform that is automatically called for all
  instantations.
- `patch`: Accepts a list of patches

Operations:

- `patch`: Accepts a list of patches
- `variables`: Accepts an operation variable patch
- `data`: Accepts an operation data patch

When defining custom transforms, the `default` transform has special meaning: it
will be automatically applied as the first aptch to all instances.
