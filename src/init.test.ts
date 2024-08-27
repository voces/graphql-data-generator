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

Deno.test("objects > patch transform", () => {
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

Deno.test("objects > custom transfomrs", () => {
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
        profilePicture: null,
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

  assertEquals(build.User().withPost().posts.length, 1);
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
