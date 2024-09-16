# graphql-data-generator

A tool to generate objects and operation mocks from a GraphQL schema.

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
    // `default` automatically applies to all Users
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
