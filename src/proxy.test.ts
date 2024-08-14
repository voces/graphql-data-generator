import { __Type, parse } from "npm:graphql";
import { proxy } from "./proxy.ts";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { Inputs, Types } from "../examples/board/types.ts";
import { serialize } from "./util.ts";

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const { definitions } = parse(schema);
const scalars = new Proxy({}, {
  get: (_, prop) => (t: string) => `scalar-${prop.toString()}-${t}`,
  has: () => true,
});

Deno.test("objects > simple object generation", () => {
  assertEquals(
    serialize(
      proxy<Types["Post"]>(
        definitions,
        scalars,
        "Post",
      ),
    ),
    {
      __typename: "Post",
      id: "scalar-ID-Post",
      createdAt: "scalar-DateTime-Post",
      title: "scalar-String-Post",
      content: "scalar-String-Post",
      author: {
        __typename: "User",
        id: "scalar-ID-User",
        createdAt: "scalar-DateTime-User",
        name: "scalar-String-User",
        email: "scalar-String-User",
        role: "ADMIN",
        profilePicture: null,
        posts: [],
      },
    },
  );
});

Deno.test("objects > overwrite field", () => {
  assertEquals(
    serialize(
      proxy<Types["User"]>(definitions, scalars, "User", { id: "my-id" }),
    ),
    {
      __typename: "User",
      id: "my-id",
      createdAt: "scalar-DateTime-User",
      name: "scalar-String-User",
      email: "scalar-String-User",
      role: "ADMIN",
      profilePicture: null,
      posts: [],
    },
  );
});

Deno.test("objects > overwrite the same field twice", () => {
  assertEquals(
    serialize(
      proxy<Types["User"]>(
        definitions,
        scalars,
        "User",
        { id: "my-id" },
        { id: "my-id-2" },
      ),
    ),
    {
      __typename: "User",
      id: "my-id-2",
      createdAt: "scalar-DateTime-User",
      name: "scalar-String-User",
      email: "scalar-String-User",
      role: "ADMIN",
      profilePicture: null,
      posts: [],
    },
  );
});

Deno.test("objects > overwrite different field sets", () => {
  assertEquals(
    serialize(
      proxy<Types["User"]>(
        definitions,
        scalars,
        "User",
        { id: "my-id" },
        { name: "my-name" },
      ),
    ),
    {
      __typename: "User",
      id: "my-id",
      createdAt: "scalar-DateTime-User",
      name: "my-name",
      email: "scalar-String-User",
      role: "ADMIN",
      profilePicture: null,
      posts: [],
    },
  );
});

Deno.test("objects > overwrite with functions", () => {
  assertEquals(
    serialize(
      proxy<Types["User"]>(
        definitions,
        scalars,
        "User",
        {
          id: (u) => {
            // Base object
            assertEquals(serialize(u), {
              __typename: "User",
              id: "scalar-ID-User",
              createdAt: "scalar-DateTime-User",
              name: "scalar-String-User",
              email: "scalar-String-User",
              role: "ADMIN",
              profilePicture: null,
              posts: [],
            });
            return "my-id";
          },
        },
        {
          name: (u) => {
            // Base object + id from previous patch
            assertEquals(serialize(u), {
              __typename: "User",
              id: "my-id",
              createdAt: "scalar-DateTime-User",
              name: "scalar-String-User",
              email: "scalar-String-User",
              role: "ADMIN",
              profilePicture: null,
              posts: [],
            });
            return "my-name";
          },
        },
      ),
    ),
    {
      __typename: "User",
      id: "my-id",
      createdAt: "scalar-DateTime-User",
      name: "my-name",
      email: "scalar-String-User",
      role: "ADMIN",
      profilePicture: null,
      posts: [],
    },
  );
});

Deno.test("objects > individual fields with multiple patches", () => {
  assertEquals(
    proxy<Types["Post"]>(definitions, scalars, "Post", { id: "my-id-1" }, {
      id: (p) => {
        assertEquals(p.id, "my-id-1");
        return "my-id-2";
      },
    })
      .id,
    "my-id-2",
  );
});

Deno.test("objects > matching multiple different fields", () => {
  const post = proxy<Types["Post"]>(
    definitions,
    scalars,
    "Post",
    { id: "my-id" },
    { content: "my-content" },
  );
  assertEquals(post.id, "my-id");
  assertEquals(post.content, "my-content");
});

Deno.test("objects > overriding with undefined has no impact", () => {
  assertEquals(
    proxy<Types["User"]>(definitions, scalars, "User", { id: undefined }).id,
    "scalar-ID-User",
  );

  assertEquals(
    proxy<Types["User"]>(definitions, scalars, "User", { id: "heh" }, {
      id: undefined,
    }).id,
    "heh",
  );

  assertEquals(
    proxy<Types["User"]>(definitions, scalars, "User", { id: "heh" }, {
      id: () => undefined,
    }).id,
    "heh",
  );
});

Deno.test("objects > interfaces > can resolve an interface with no patches", () => {
  assertEquals(
    serialize(proxy<Types["User"]>(definitions, scalars, "Node")),
    {
      __typename: "User",
      createdAt: "scalar-DateTime-User",
      email: "scalar-String-User",
      id: "scalar-ID-User",
      name: "scalar-String-User",
      profilePicture: null,
      role: "ADMIN",
      posts: [],
    },
  );
});

Deno.test("objects > interfaces > can resolve an inteface with a field hint", () => {
  assertObjectMatch(
    serialize(
      proxy<Types["Post"]>(definitions, scalars, "Node", { title: "heh" }),
    ),
    { __typename: "Post", title: "heh", author: { __typename: "User" } },
  );
});

Deno.test("objects > arrays > simple", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: [{ id: "heh" }] },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh" });
});

Deno.test("objects > arrays twice", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: [{ id: "heh" }] },
    { posts: [{ id: (prev) => prev.id + "1" }] },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh1" });
});

Deno.test("objects > arrays > shorten", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: [{ id: "post-1" }, { id: "post-2" }] },
    { posts: (p) => p.posts.slice(0, 1) },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "post-1" });
});

Deno.test("objects > arrays > object > simple", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: { 0: { id: "heh" } } },
    { posts: { 0: { id: (p) => p.id + "1" } } },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh1" });
});

Deno.test("objects > arrays > object > length", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: [{ id: "post-1" }, { id: "post-2" }] },
    { posts: { length: 1 } },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "post-1" });
});

Deno.test("objects > arrays > object > last > simple", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: { last: { id: "heh" } } },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh" });
});

Deno.test("objects > arrays > object > last > twice", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: { last: { id: "heh1" } } },
    { posts: { last: { id: "heh2" } } },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh2" });
});

Deno.test("objects > arrays > object > next > simple", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: { next: { id: "heh" } } },
  ).posts;
  assertEquals(userPosts.length, 1);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh" });
});

Deno.test("objects > arrays > object > next > twice", () => {
  const userPosts = proxy<Types["User"]>(
    definitions,
    scalars,
    "User",
    { posts: { next: { id: "heh1" } } },
    { posts: { next: { id: "heh2" } } },
  ).posts;
  assertEquals(userPosts.length, 2);
  assertObjectMatch(userPosts[0], { __typename: "Post", id: "heh1" });
  assertObjectMatch(userPosts[1], { __typename: "Post", id: "heh2" });
});

Deno.test("inputs > simple", () => {
  assertEquals(
    serialize(
      proxy<Inputs["CreateUserInput"]>(definitions, scalars, "CreateUserInput"),
    ),
    {
      email: "scalar-String-CreateUserInput",
      name: "scalar-String-CreateUserInput",
      role: "ADMIN",
      profilePicture: null,
    },
  );
});

Deno.test("inputs > patch", () => {
  assertEquals(
    proxy<Inputs["CreateUserInput"]>(definitions, scalars, "CreateUserInput", {
      name: (v) => `was length ${v.name.length}`,
    }).name,
    "was length 29",
  );
});

Deno.test("inputs > nested", () => {
  assertEquals(
    serialize(
      proxy(
        definitions,
        scalars,
        "CreatePostAndUpdateUser",
      ),
    ),
    {
      createPost: {
        authorId: "scalar-ID-CreatePostInput",
        content: "scalar-String-CreatePostInput",
        title: "scalar-String-CreatePostInput",
      },
      updateUser: {
        email: null, // nullable because update input
        id: "scalar-ID-UpdateUserInput",
        name: null,
        profilePicture: null,
        role: null,
      },
    },
  );
});
