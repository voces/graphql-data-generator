import { assertEquals } from "jsr:@std/assert";
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
} from "../examples/board/types.ts";
import { init } from "./init.ts";
import { Patch } from "./types.ts";
import { OperationMockFromType } from "./types.test.ts";

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const scalars = new Proxy({}, {
  get: (_, prop) => (t: string) => `scalar-${prop.toString()}-${t}`,
  has: () => true,
});

const build = init<Query, Mutation, Subscription, Types, Inputs>(
  schema,
  queries,
  mutations,
  subscriptions,
  types,
  inputs,
  scalars,
)(() => ({
  User: {
    default: { profilePicture: (u) => `https://example.com/${u.id}.png` },
    withPost: (_p, post: Patch<Types["Post"]> = {}) => ({
      posts: { next: post },
    }),
  },
  Post: {
    default: (u) => ({ content: `Post by ${u.author.name}` }),
  },
  queryWithVariables: {
    default: { variables: { nullableNullableScalars: { 1: "ok" } } },
    flip: { data: { queryWithVariables: (v) => !v.queryWithVariables } },
  },
  CreatePost: {
    withAuthorId: (_, id: string) => ({
      variables: { input: { authorId: id } },
      data: { createPost: { author: { id } } },
    }),
  },
}));

Deno.test("objects", () => {
  assertEquals<Types["User"]>(
    build.User(),
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "scalar-ID-User",
      name: "scalar-String-User",
      posts: [],
      // From default transform
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
  );

  assertEquals<Types["Post"]>(build.Post(), {
    __typename: "Post",
    author: {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "scalar-ID-User",
      name: "scalar-String-User",
      posts: [],
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
    content: "Post by scalar-String-User",
    createdAt: "scalar-DateTime-Post",
    id: "scalar-ID-Post",
    title: "scalar-String-Post",
  });
});

Deno.test("objects > arg patch", () => {
  assertEquals<Types["User"]>(
    build.User({ id: "heh", email: (u) => u.email + "2" }),
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User2",
      id: "heh",
      name: "scalar-String-User",
      posts: [],
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
  );
});

Deno.test("objects > patch transform on object", () => {
  const user = build.User({ id: "my-id" });
  const extended = user.patch({ name: (u) => `${u.id}'s name` });

  assertEquals<Types["User"]>(
    user,
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "my-id",
      name: "scalar-String-User",
      posts: [],
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
  );
  assertEquals<Types["User"]>(
    extended,
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "my-id",
      name: "my-id's name",
      posts: [],
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
  );
});

Deno.test("objects > patch transform on builder", () => {
  assertEquals<Types["User"]>(
    build.User.patch({ name: (u) => `${u.id}'s name` }),
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "scalar-ID-User",
      name: "scalar-ID-User's name",
      posts: [],
      profilePicture: "https://example.com/scalar-ID-User.png",
      role: "ADMIN",
    },
  );
});

Deno.test("objects > custom transform on object", () => {
  assertEquals(build.User({ posts: [{}] }).withPost().posts.length, 2);
});

Deno.test("objects > custom transform on builder", () => {
  assertEquals<Types["User"]>(build.User.withPost(), {
    __typename: "User",
    createdAt: "scalar-DateTime-User",
    email: "scalar-String-User",
    id: "scalar-ID-User",
    name: "scalar-String-User",
    posts: [{
      __typename: "Post",
      author: {
        __typename: "User",
        createdAt: "scalar-DateTime-User",
        email: "scalar-String-User",
        id: "scalar-ID-User",
        name: "scalar-String-User",
        posts: [],
        profilePicture: "https://example.com/scalar-ID-User.png",
        role: "ADMIN",
      },
      content: "scalar-String-Post",
      createdAt: "scalar-DateTime-Post",
      id: "scalar-ID-Post",
      title: "scalar-String-Post",
    }],
    profilePicture: "https://example.com/scalar-ID-User.png",
    role: "ADMIN",
  });
});

Deno.test("inputs", () => {
  assertEquals<Inputs["CreatePostInput"]>(
    build.CreatePostInput(),
    {
      authorId: "scalar-ID-CreatePostInput",
      content: "scalar-String-CreatePostInput",
      title: "scalar-String-CreatePostInput",
    },
  );
});

Deno.test("inputs > arg patches", () => {
  assertEquals<Inputs["CreatePostInput"]>(
    build.CreatePostInput(
      { authorId: "my-id" },
      { authorId: (i) => `${i.authorId}2` },
      (i) => ({ authorId: `${i.authorId}3` }),
    ),
    {
      authorId: "my-id23",
      content: "scalar-String-CreatePostInput",
      title: "scalar-String-CreatePostInput",
    },
  );
});

Deno.test("query", async () => {
  assertEquals<OperationMockFromType<Query["queryWithVariables"]>>(
    build.queryWithVariables(),
    {
      request: {
        query: await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        variables: {
          nonnullableScalar: "scalar-String-queryWithVariablesVariables",
          nullableNullableScalars: [null, "ok"],
          nonnullableNonnullableScalars: [],
          nonnullableNonnullableNonnullableScalars: [],
        },
      },
      result: { data: { queryWithVariables: null } },
    },
  );
});

Deno.test("query > arg patch", async () => {
  assertEquals<OperationMockFromType<Query["queryWithVariables"]>>(
    build.queryWithVariables({
      variables: { nullableNullableNullableScalars: [] },
      data: { queryWithVariables: () => true },
    }),
    {
      request: {
        query: await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        variables: {
          nonnullableScalar: "scalar-String-queryWithVariablesVariables",
          nullableNullableScalars: [null, "ok"],
          nonnullableNonnullableScalars: [],
          nullableNullableNullableScalars: [],
          nonnullableNonnullableNonnullableScalars: [],
        },
      },
      result: { data: { queryWithVariables: true } },
    },
  );
});

Deno.test("query > patch transform on object", async () => {
  assertEquals<OperationMockFromType<Query["queryWithVariables"]>>(
    build.queryWithVariables().patch({ data: { queryWithVariables: false } }),
    {
      request: {
        query: await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        variables: {
          nonnullableScalar: "scalar-String-queryWithVariablesVariables",
          nullableNullableScalars: [null, "ok"],
          nonnullableNonnullableScalars: [],
          nonnullableNonnullableNonnullableScalars: [],
        },
      },
      result: { data: { queryWithVariables: false } },
    },
  );
});

Deno.test("query > patch transform on builder", async () => {
  assertEquals<OperationMockFromType<Query["queryWithVariables"]>>(
    build.queryWithVariables.patch({ data: { queryWithVariables: false } }),
    {
      request: {
        query: await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        variables: {
          nonnullableScalar: "scalar-String-queryWithVariablesVariables",
          nullableNullableScalars: [null, "ok"],
          nonnullableNonnullableScalars: [],
          nonnullableNonnullableNonnullableScalars: [],
        },
      },
      result: { data: { queryWithVariables: false } },
    },
  );
});

Deno.test("query > custom transform on object", () => {
  const o1 = build.queryWithVariables();
  const o2 = o1.flip();
  const o3 = o2.flip();

  assertEquals(o1.result.data?.queryWithVariables, null);
  assertEquals(o2.result.data?.queryWithVariables, true);
  assertEquals(o3.result.data?.queryWithVariables, false);
});

Deno.test("query > custom transform on builder", () => {
  assertEquals(
    build.queryWithVariables.flip().result.data?.queryWithVariables,
    true,
  );
});

Deno.test("query > fragments", async () => {
  assertEquals<OperationMockFromType<Query["Search"]>>(
    build.Search({ data: { search: [{ title: "title" }] } }),
    {
      request: {
        query: (await Deno.readTextFile("examples/board/Search.gql")).replace(
          '#import "./NodeFragment.gql"',
          await Deno.readTextFile("examples/board/NodeFragment.gql"),
        ),
        variables: { term: "scalar-String-SearchVariables" },
      },
      result: {
        data: {
          search: [{
            __typename: "Post",
            content: "scalar-String-Post",
            id: "scalar-ID-User",
            title: "title",
          }],
        },
      },
    },
  );
});

Deno.test("query > empty patch clones", () => {
  const getObjects = (
    object: Record<string, unknown>,
    set = new Set<Record<string, unknown>>(),
  ) => {
    if (set.has(object)) return set;
    set.add(object);
    for (const prop in object) {
      const value = object[prop];
      if (value && typeof value === "object") {
        getObjects(value as Record<string, unknown>, set);
      }
    }
    return set;
  };

  const a = build.Search();
  const b = a.patch({});

  const aObjects = getObjects(a);
  const bObjects = getObjects(b);

  for (const obj of aObjects) {
    if (bObjects.has(obj)) {
      throw new Error(
        `Expected a and b to have no shared objects, but they share ${obj}`,
      );
    }
  }
});

Deno.test("mutation", async () => {
  assertEquals<OperationMockFromType<Mutation["CreatePost"]>>(
    build.CreatePost({ data: { createPost: { id: "post-id" } } })
      .withAuthorId("user-id"),
    {
      request: {
        query: await Deno.readTextFile("examples/board/CreatePost.gql"),
        variables: {
          input: {
            authorId: "user-id",
            content: "scalar-String-CreatePostInput",
            title: "scalar-String-CreatePostInput",
          },
        },
      },
      result: {
        data: {
          createPost: {
            __typename: "Post",
            author: {
              __typename: "User",
              id: "user-id",
              name: "scalar-String-User",
            },
            content: "scalar-String-Post",
            createdAt: "scalar-DateTime-Post",
            id: "post-id",
            title: "scalar-String-Post",
          },
        },
      },
    },
  );
});

Deno.test("subscription", async () => {
  assertEquals<OperationMockFromType<Subscription["OnPostCreated"]>>(
    build.OnPostCreated(),
    {
      request: {
        query: await Deno.readTextFile("examples/board/OnPostCreated.gql"),
      },
      result: {
        data: {
          postCreated: {
            __typename: "Post",
            author: {
              __typename: "User",
              id: "scalar-ID-User",
              name: "scalar-String-User",
            },
            content: "scalar-String-Post",
            createdAt: "scalar-DateTime-Post",
            id: "scalar-ID-Post",
            title: "scalar-String-Post",
          },
        },
      },
    },
  );
});

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
