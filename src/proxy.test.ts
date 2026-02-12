import { __Type, GraphQLError, parse } from "npm:graphql";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { clear, operation, proxy } from "./proxy.ts";
import type {
  Inputs,
  Mutation,
  Query,
  Subscription,
  Types,
} from "../examples/board/types.ts";

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const { definitions } = parse(schema);
const scalars = new Proxy({}, {
  get: (_, prop) => (t: string) => `scalar-${prop.toString()}-${t}`,
  has: () => true,
});

Deno.test("scalars > built-in", () => {
  assertEquals(proxy(definitions, scalars, "String"), "scalar-String-String");
  assertEquals(proxy<string>(definitions, scalars, "String", "ok"), "ok");
});

Deno.test("scalars > custom", () => {
  assertEquals(proxy(definitions, scalars, "URL"), "scalar-URL-URL");
  assertEquals(proxy<string>(definitions, scalars, "URL", "ok"), "ok");
});

Deno.test("scalars > list", () => {
  assertEquals(
    proxy(definitions, scalars, "Query.nonnullableNonnullableScalars"),
    [],
  );

  assertEquals(
    proxy<string[]>(
      definitions,
      scalars,
      "Query.nonnullableNonnullableScalars",
      { 1: "ok" },
    ),
    ["scalar-String-Query", "ok"],
  );
});

Deno.test("objects > simple object generation", () => {
  assertEquals(
    proxy<Types["Post"]>(definitions, scalars, "Post"),
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
      coauthor: null,
    },
  );
});

Deno.test("objects > overwrite field", () => {
  assertEquals(
    proxy<Types["User"]>(definitions, scalars, "User", { id: "my-id" }),
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
    proxy<Types["User"]>(
      definitions,
      scalars,
      "User",
      { id: "my-id" },
      { id: "my-id-2" },
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
    proxy<Types["User"]>(
      definitions,
      scalars,
      "User",
      { id: "my-id" },
      { name: "my-name" },
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
    proxy<Types["User"]>(
      definitions,
      scalars,
      "User",
      {
        id: (u) => {
          // Base object
          assertEquals(u, {
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
          assertEquals(u, {
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

  assertEquals(
    proxy<Types["User"]>(
      definitions,
      scalars,
      "User",
      { profilePicture: "yo" },
      { profilePicture: undefined },
    ).profilePicture,
    "yo",
  );
});

Deno.test("objects > overriding with null has impact", () => {
  assertEquals(
    proxy<Types["User"]>(
      definitions,
      scalars,
      "User",
      { profilePicture: "yo" },
      { profilePicture: null },
    ).profilePicture,
    null,
  );
});

Deno.test("objects > incompatible patches goes with past patch", () => {
  assertEquals(
    proxy<Types["Post"] | Types["User"]>(
      definitions,
      scalars,
      "Query.node",
      { name: "my-name" },
      { title: "my-title" },
    ),
    {
      __typename: "Post",
      id: "scalar-ID-User",
      title: "my-title",
      createdAt: "scalar-DateTime-User",
      content: "scalar-String-Post",
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
      coauthor: null,
    },
  );

  assertEquals(
    proxy<Types["Post"] | Types["User"]>(
      definitions,
      scalars,
      "Query.node",
      { name: "my-name" },
      { title: "my-title" },
      { name: "my-name" },
    ).__typename,
    "User",
  );
});

Deno.test("objects > interfaces > can resolve an interface with no patches", () => {
  assertEquals(
    proxy<Types["User"]>(definitions, scalars, "Node"),
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

Deno.test("objects > interfaces > can resolve an interface with a field hint", () => {
  assertObjectMatch(
    proxy<Types["Post"]>(definitions, scalars, "Node", { title: "heh" }),
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
    proxy<Inputs["CreateUserInput"]>(definitions, scalars, "CreateUserInput"),
    {
      email: "scalar-String-CreateUserInput",
      name: "scalar-String-CreateUserInput",
      role: "ADMIN",
      profilePicture: undefined,
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
    proxy(definitions, scalars, "CreatePostAndUpdateUser"),
    {
      createPost: {
        authorId: "scalar-ID-CreatePostInput",
        content: "scalar-String-CreatePostInput",
        title: "scalar-String-CreatePostInput",
      },
      updateUser: {
        email: undefined, // nullable because update input
        id: "scalar-ID-UpdateUserInput",
        name: undefined,
        profilePicture: undefined,
        role: undefined,
      },
    },
  );
});

Deno.test("operations > queries > nonnullableScalar", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { nonnullableScalar: "scalar-String-Query" } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableScalar: "override" },
    }).result.data?.nonnullableScalar,
    "override",
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableScalar: (p) => `${p.nonnullableScalar}-2` },
    }).result.data?.nonnullableScalar,
    "scalar-String-Query-2",
  );
});

Deno.test("operations > queries > nullable scalar", () => {
  const query = "query Foo { nullableScalar }";
  type Operation = { data: { nullableScalar: string | null } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { nullableScalar: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableScalar: "ok" },
    }).result.data?.nullableScalar,
    "ok",
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableScalar: "ok" },
    }, {
      data: { nullableScalar: null },
    }).result.data?.nullableScalar,
    null,
  );
});

Deno.test("operations > queries > nonnullableNonnullableScalars", () => {
  const query = "query Foo { nonnullableNonnullableScalars }";
  type Operation = { data: { nonnullableNonnullableScalars: string[] } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { nonnullableNonnullableScalars: [] } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: ["foo"] },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { 1: "foo" } },
    }),
    {
      request: { query: parse(query) },
      result: {
        data: {
          nonnullableNonnullableScalars: ["scalar-String-Query", "foo"],
        },
      },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { next: "foo" } },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { next: "foo" } },
    }, {
      data: { nonnullableNonnullableScalars: { next: "foo" } },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableScalars: ["foo", "foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { last: "bar" } },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableScalars: ["bar"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { next: "foo" } },
    }, {
      data: { nonnullableNonnullableScalars: { last: "bar" } },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableScalars: ["bar"] } },
    },
  );
});

Deno.test("operations > queries > nullableNonnullableScalars", () => {
  const query = "query Foo { nullableNonnullableScalars }";
  type Operation = { data: { nullableNonnullableScalars: string[] | null } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { nullableNonnullableScalars: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: [] },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nullableNonnullableScalars: [] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: ["foo"] },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nullableNonnullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: { 1: "foo" } },
    }),
    {
      request: { query: parse(query) },
      result: {
        data: { nullableNonnullableScalars: ["scalar-String-Query", "foo"] },
      },
    },
  );
});

Deno.test("operations > queries > nullableNullableScalars", () => {
  const query = "query Foo { nullableNullableScalars }";
  type Operation = {
    data: { nullableNullableScalars: (string | null)[] | null };
  };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { nullableNullableScalars: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: [] },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nullableNullableScalars: [] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: ["foo"] },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nullableNullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: { 1: "foo" } },
    }),
    {
      request: { query: parse(query) },
      result: { data: { nullableNullableScalars: [null, "foo"] } },
    },
  );
});

Deno.test(
  "operations > queries > nonnullableNonnullableNonnullableScalars",
  () => {
    const query = "query Foo { nonnullableNonnullableNonnullableScalars }";
    type Operation = {
      data: {
        nonnullableNonnullableNonnullableScalars: ((string | null)[] | null)[];
      };
    };

    assertEquals(operation<Operation>(definitions, scalars, query), {
      request: { query: parse(query) },
      result: { data: { nonnullableNonnullableNonnullableScalars: [] } },
    });

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nonnullableNonnullableNonnullableScalars: [] },
      }),
      {
        request: { query: parse(query) },
        result: { data: { nonnullableNonnullableNonnullableScalars: [] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nonnullableNonnullableNonnullableScalars: [["foo"]] },
      }),
      {
        request: { query: parse(query) },
        result: {
          data: { nonnullableNonnullableNonnullableScalars: [["foo"]] },
        },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: {
          nonnullableNonnullableNonnullableScalars: { 1: { 1: "foo" } },
        },
      }),
      {
        request: { query: parse(query) },
        result: {
          data: {
            nonnullableNonnullableNonnullableScalars: [[], [
              "scalar-String-Query",
              "foo",
            ]],
          },
        },
      },
    );
  },
);

Deno.test(
  "operations > queries > nullableNullableNullableScalars",
  () => {
    const query = "query Foo { nullableNullableNullableScalars }";
    type Operation = {
      data: {
        nullableNullableNullableScalars: ((string | null)[] | null)[] | null;
      };
    };

    assertEquals(operation<Operation>(definitions, scalars, query), {
      request: { query: parse(query) },
      result: { data: { nullableNullableNullableScalars: null } },
    });

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: [] },
      }),
      {
        request: { query: parse(query) },
        result: { data: { nullableNullableNullableScalars: [] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: [["foo"]] },
      }),
      {
        request: { query: parse(query) },
        result: { data: { nullableNullableNullableScalars: [["foo"]] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: { 1: { 1: "foo" } } },
      }),
      {
        request: { query: parse(query) },
        result: {
          data: { nullableNullableNullableScalars: [null, [null, "foo"]] },
        },
      },
    );
  },
);

Deno.test("operations > queries > aliasing", () => {
  const query = "query Foo { foo: nonnullableScalar }";
  type Operation = { data: { foo: string } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query: parse(query) },
    result: { data: { foo: "scalar-String-Query" } },
  });
});

Deno.test("operations > queries > objects", async () => {
  const query = await Deno.readTextFile("examples/board/GetNode.gql");

  assertEquals(
    operation<Query["GetNode"]>(definitions, scalars, query).result,
    {
      data: {
        node: {
          __typename: "User",
          email: "scalar-String-User",
          id: "scalar-ID-User",
          name: "scalar-String-User",
        },
      },
    },
  );

  assertEquals(
    operation<Query["GetNode"]>(definitions, scalars, query, {
      data: { node: { title: "yoo" } },
    }).result,
    {
      data: {
        node: {
          __typename: "Post",
          content: "scalar-String-Post",
          // Type is User because prev didn't have a hint
          id: "scalar-ID-User",
          title: "yoo",
        },
      },
    },
  );
});

Deno.test("operations > queries > objects > union aliased field narrowing", () => {
  // When a union type has inline fragments with aliased fields,
  // type narrowing should work with the alias name in the patch
  const query = `
    query GetNode($id: ID!) {
      node(id: $id) {
        ... on User {
          userId: id
          userName: name
          userEmail: email
        }
        ... on Post {
          postId: id
          postTitle: title
          postContent: content
        }
      }
    }
  `;
  type Operation = {
    data: {
      node: {
        __typename: "User";
        userId: string;
        userName: string;
        userEmail: string;
      } | {
        __typename: "Post";
        postId: string;
        postTitle: string;
        postContent: string;
      };
    };
  };

  // Without patch, defaults to first type (User)
  assertEquals(
    operation<Operation>(definitions, scalars, query).result.data!.node
      .__typename,
    "User",
  );

  // Narrowing with aliased field should resolve to Post
  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { node: { postTitle: "My Post" } },
    }).result.data!.node.__typename,
    "Post",
  );

  // Narrowing with aliased field should resolve to User
  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { node: { userName: "John" } },
    }).result.data!.node.__typename,
    "User",
  );
});

Deno.test("operations > queries > objects > deep aliasing", async () => {
  const query = await Deno.readTextFile("examples/board/GetUserPosts.gql");

  assertEquals(
    operation<Query["GetUserPosts"]>(definitions, scalars, query).result,
    {
      data: {
        user: { __typename: "User", userId: "scalar-ID-User", posts: [] },
      },
    },
  );

  assertEquals(
    operation<Query["GetUserPosts"]>(definitions, scalars, query, {
      data: { user: { posts: [{}] } },
    }).result,
    {
      data: {
        user: {
          __typename: "User",
          userId: "scalar-ID-User",
          posts: [{ __typename: "Post", postId: "scalar-ID-Post" }],
        },
      },
    },
  );
});

Deno.test("operations > queries > variables", async () => {
  const query = await Deno.readTextFile(
    "examples/board/queryWithVariables.gql",
  );

  assertEquals(
    operation<Query["queryWithVariables"]>(definitions, scalars, query).request
      .variables,
    {
      nonnullableScalar: "scalar-String-queryWithVariablesVariables",
      nonnullableNonnullableScalars: [],
      nonnullableNonnullableNonnullableScalars: [],
    },
  );

  assertEquals(
    operation<Query["queryWithVariables"]>(definitions, scalars, query, {
      variables: {
        nonnullableScalar: "a",
        nullableScalar: "b",
        nonnullableNonnullableScalars: { 1: "c" },
        nullableNullableScalars: { 1: "d" },
        nonnullableNonnullableNonnullableScalars: { 1: { 1: "e" } },
        nullableNullableNullableScalars: { 1: { 1: "f" } },
      },
    }).request.variables,
    {
      nonnullableScalar: "a",
      nullableScalar: "b",
      nonnullableNonnullableScalars: [
        "scalar-String-queryWithVariablesVariables",
        "c",
      ],
      nullableNullableScalars: [null, "d"],
      nonnullableNonnullableNonnullableScalars: [[], [
        "scalar-String-queryWithVariablesVariables",
        "e",
      ]],
      nullableNullableNullableScalars: [null, [null, "f"]],
    },
  );
});

Deno.test("operations > queries > error", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string }; error: Error };
  const error = new Error("oops");

  assertEquals(
    operation<Operation>(definitions, scalars, query, { error }),
    { request: { query: parse(query) }, result: {}, error },
  );
});

Deno.test("operations > queries > prev error preserved", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string }; error: Error };
  const error = new Error("oops");

  assertEquals(
    operation<Operation>(definitions, scalars, query, { error }, {}),
    { request: { query: parse(query) }, result: {}, error },
  );
});

Deno.test("operations > queries > errors", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };
  const error = new GraphQLError("oops");

  assertEquals(
    operation<Operation>(definitions, scalars, query, { errors: [error] }),
    {
      request: { query: parse(query) },
      result: {
        // TODO: Should allow and default to null data if errors present, unless
        // patched in
        data: { nonnullableScalar: "scalar-String-Query" },
        errors: [error],
      },
    },
  );
});

Deno.test("operations > queries > data null with errors", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };
  const error = new GraphQLError("oops");

  // Allow explicitly setting data to null, overriding previous data value
  const result = operation<Operation>(
    definitions,
    scalars,
    query,
    { data: { nonnullableScalar: "some value" } },
    { data: null, errors: [error] },
  );
  assertEquals(result.result.data, null);
  assertEquals(result.result.errors, [error]);
});

Deno.test("operations > queries > prev errors preserved", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };
  const error = new GraphQLError("oops");

  assertEquals(
    operation<Operation>(definitions, scalars, query, { errors: [error] }, {}),
    {
      request: { query: parse(query) },
      result: {
        data: { nonnullableScalar: "scalar-String-Query" },
        errors: [error],
      },
    },
  );
});

Deno.test("operations > queries > patch > error", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };
  const error = new Error("some error");

  assertEquals(
    operation<Operation>(
      definitions,
      scalars,
      query,
      { data: { nonnullableScalar: "myvalue" } },
      { error },
    ),
    {
      request: { query: parse(query) },
      error,
      result: {},
    },
  );
});

Deno.test("operations > queries > patch > errors", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };
  const error = new GraphQLError("oops");

  assertEquals(
    operation<Operation>(
      definitions,
      scalars,
      query,
      { data: { nonnullableScalar: "myvalue" } },
      { errors: [error] },
    ),
    {
      request: { query: parse(query) },
      result: {
        data: { nonnullableScalar: "myvalue" },
        errors: [error],
      },
    },
  );
});

Deno.test("operations > mutations", async () => {
  const query = await Deno.readTextFile("examples/board/CreateUser.gql");

  assertEquals(
    operation<Mutation["CreateUser"]>(definitions, scalars, query, {
      variables: { input: { name: "name" } },
      data: { createUser2: { name: "name" } },
    }),
    {
      request: {
        query: parse(query),
        variables: {
          input: {
            email: "scalar-String-CreateUserInput",
            name: "name",
            role: "ADMIN",
            // TODO: should be optional
            profilePicture: undefined,
          },
          foo: "scalar-ID-CreateUserVariables",
        },
      },
      result: {
        data: {
          createUser2: {
            __typename: "User",
            id: "scalar-ID-User",
            name: "name",
            foo: "scalar-String-User",
            role: "ADMIN",
            profilePicture: null,
            createdAt: "scalar-DateTime-User",
          },
        },
      },
    },
  );
});

Deno.test("operations > subscriptions", async () => {
  const query = await Deno.readTextFile("examples/board/OnPostCreated.gql");

  assertEquals(
    operation<Subscription["OnPostCreated"]>(definitions, scalars, query, {
      data: { postCreated: { title: "title" } },
    }),
    {
      request: { query: parse(query) },
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
            title: "title",
          },
        },
      },
    },
  );
});

Deno.test("operations > retains extra top level data", async () => {
  const query = await Deno.readTextFile("examples/board/OnPostCreated.gql");

  assertEquals(
    operation<Subscription["OnPostCreated"], { extra?: string }>(
      definitions,
      scalars,
      query,
      { extra: "foo" },
      { data: { postCreated: { title: "title" } } },
    ).extra,
    "foo",
  );
});

Deno.test("unions", () => {
  assertEquals(
    proxy<{ __typename: "User" | "Post" }>(
      definitions,
      scalars,
      "SearchResult",
    ).__typename,
    "User",
  );

  assertEquals(
    proxy<{ __typename: "User" | "Post"; title?: string }>(
      definitions,
      scalars,
      "SearchResult",
      { title: "ok" },
    ).__typename,
    "Post",
  );

  assertEquals(
    proxy<{ __typename: "User" | "Post"; title?: string }>(
      definitions,
      scalars,
      "SearchResult",
      { __typename: "Post" },
    ).__typename,
    "Post",
  );
});

Deno.test("unions > as a field", () => {
  assertEquals(
    proxy<{ result: { __typename: "User" } }>(
      definitions,
      scalars,
      "WrappedSearchResult",
    ).result.__typename,
    "User",
  );
});

Deno.test("unions > list", () => {
  assertEquals(proxy(definitions, scalars, "Query.search"), []);

  assertEquals(
    proxy<Query["Search"]["data"]["search"]>(
      definitions,
      scalars,
      "Query.search",
      [{}, { title: "ok" }],
    ).map((v) => v.__typename),
    ["User", "Post"],
  );
});

Deno.test("interfaces", () => {
  assertEquals(proxy<Types["User"]>(definitions, scalars, "Node"), {
    __typename: "User",
    createdAt: "scalar-DateTime-User",
    email: "scalar-String-User",
    id: "scalar-ID-User",
    name: "scalar-String-User",
    posts: [],
    profilePicture: null,
    role: "ADMIN",
  });
});

Deno.test("interfaces > hint", () => {
  assertEquals(
    proxy<Types["Post"]>(definitions, scalars, "Node", { title: "ok" })
      .__typename,
    "Post",
  );
});

Deno.test("interfaces > list", () => {
  assertEquals(
    proxy<{ __typename: string }[]>(definitions, scalars, "Query.search"),
    [],
  );

  assertEquals(
    proxy<{ __typename: string; title?: string }[]>(
      definitions,
      scalars,
      "Query.search",
      { 1: { title: "ok" } },
    )
      .map((v) => v.__typename),
    ["User", "Post"],
  );
});

Deno.test("interfaces > aliases", () => {
  const schema = parse(`
    interface Interface {
      interface: String!
    }

    type FooChild {
      value: String!
    }

    type Foo implements Interface {
      foo: String!
      fooChild: FooChild
    }

    type Bar implements Interface {
      bar: String!
    }

    type Container {
      foo: Interface!
    }

    type Query {
      foo: Interface!
      container: Container!
    }
  `).definitions;
  const query = `
    query getFoo {
      foo {
        aliasedInterface: interface
        ... on Foo {
          aliasedFoo: foo
          aliasedFooChild: fooChild
        }
        ... on Bar {
          aliasedBar: bar
        }
      }
    }
  `;
  type T = {
    data: {
      foo: {
        __typename: "Foo";
        aliasedInterface: string;
        aliasedFoo: string;
        aliasedFooChild?: {
          __typename: "FooChild";
          value: string;
        } | null;
      } | {
        __typename: "Bar";
        aliasedInterface: string;
        aliasedBar: string;
      };
    };
  };

  assertEquals(
    operation<T>(
      schema,
      scalars,
      query,
      { data: { foo: {} } },
    ).result.data,
    {
      foo: {
        __typename: "Foo",
        aliasedInterface: "scalar-String-Foo",
        aliasedFoo: "scalar-String-Foo",
        aliasedFooChild: null,
      },
    },
  );

  assertEquals(
    operation<T>(
      schema,
      scalars,
      query,
      { data: { foo: { aliasedInterface: "yoo", aliasedFoo: "heh" } } },
    ).result.data,
    {
      foo: {
        __typename: "Foo",
        aliasedInterface: "yoo",
        aliasedFoo: "heh",
        aliasedFooChild: null,
      },
    },
  );

  assertEquals(
    operation<T>(
      schema,
      scalars,
      query,
      { data: { foo: { aliasedInterface: "yoo", aliasedFoo: "heh" } } },
      { data: { foo: { aliasedBar: "this" } } },
    ).result.data,
    { foo: { __typename: "Bar", aliasedInterface: "yoo", aliasedBar: "this" } },
  );

  assertEquals(
    operation<T>(
      schema,
      scalars,
      query,
      { data: { foo: { aliasedFooChild: { value: "ok" } } } },
    ).result.data,
    {
      foo: {
        __typename: "Foo",
        aliasedInterface: "scalar-String-Foo",
        aliasedFoo: "scalar-String-Foo",
        aliasedFooChild: { __typename: "FooChild", value: "ok" },
      },
    },
  );

  const query2 = `
    query getContainerFoo {
      container {
        hmm: foo {
          aliasedInterface: interface
        }
      }
    }
  `;
  assertEquals(
    operation<
      {
        data: {
          container: {
            __typename: "Container";
            hmm: { __typename: "Foo"; aliasedInterface: string };
          };
        };
      }
    >(schema, scalars, query2).result.data,
    {
      container: {
        __typename: "Container",
        hmm: { __typename: "Foo", aliasedInterface: "scalar-String-Foo" },
      },
    },
  );
});

Deno.test("enums", () => {
  assertEquals(proxy(definitions, scalars, "Role"), "ADMIN");
  assertEquals(proxy(definitions, scalars, "Role", "Foo"), "Foo");
});

Deno.test("clear > top-level data fields", () => {
  const query = "query Foo { nullableNonnullableScalars }";
  type Operation = { data: { nullableNonnullableScalars: string[] | null } };

  assertEquals(
    operation<Operation>(
      definitions,
      scalars,
      query,
      { data: { nullableNonnullableScalars: ["yoo"] } },
      { data: { nullableNonnullableScalars: clear } },
    ).result.data?.nullableNonnullableScalars,
    null,
  );
});

Deno.test("clear > inputs", () => {
  assertEquals(
    proxy<Inputs["InputWithNullableArray"]>(
      definitions,
      scalars,
      "InputWithNullableArray",
      { tags: ["yoo"] },
      { tags: clear },
    ).tags,
    undefined,
  );
});

Deno.test("clear > individual variables in nested inputs", () => {
  const mutation = `
    mutation UpdateUser($id: ID!, $name: String) {
      updateUser(input: { id: $id, name: $name }) {
        id
      }
    }
  `;

  const result = operation<
    {
      variables: { id: string; name: string | undefined };
      data: { updateUser: { id: string } };
    }
  >(
    definitions,
    scalars,
    mutation,
    { variables: { id: "user-id", name: "John" } },
    { variables: { name: clear } },
  );

  assertEquals(result.request.variables?.id, "user-id");
  assertEquals(result.request.variables?.name, undefined);
});

Deno.test("clear > non-nullable variables fallback to defaults", () => {
  const mutationWithDefault = `
    mutation CreatePost($title: String! = "Default Title", $content: String!) {
      createPost(input: { title: $title, content: $content, authorId: "1" }) {
        id
      }
    }
  `;

  const resultWithDefault = operation<
    { variables: { title: string; content: string }; data: { id: string } }
  >(
    definitions,
    scalars,
    mutationWithDefault,
    { variables: { title: "My Title", content: "My Content" } },
    { variables: { title: clear, content: clear } },
  );

  // Should use the default value from the operation definition
  assertEquals(resultWithDefault.request.variables?.title, "Default Title");
  assertEquals(
    resultWithDefault.request.variables?.content,
    "scalar-String-CreatePostVariables",
  );
});

Deno.test("default values are used", () => {
  const queryWithDefault = `
    query TestQuery($id: ID! = "default-id", $foo: Int = 0) {
      node(id: $id) {
        id
      }
    }
  `;

  const result = operation<
    {
      variables: { id: string; foo: number | null };
      data: { node: { id: string } };
    }
  >(definitions, scalars, queryWithDefault);

  assertEquals(result.request.variables?.id, "default-id");
  assertEquals(result.request.variables?.foo, 0);
});

Deno.test("fragments", async () => {
  // Parse the NodeFragment definition
  const fragmentContent = await Deno.readTextFile(
    "examples/board/NodeFragment.gql",
  );
  const fragmentDoc = parse(fragmentContent);
  const allDefinitions = [...definitions, ...fragmentDoc.definitions];

  // Test that we can build a fragment object (using unknown since NodeFragment type isn't generated in test types)
  const nodeFragment = proxy<unknown>(
    allDefinitions,
    scalars,
    "NodeFragment",
  );

  assertEquals(nodeFragment, {
    __typename: "User", // Resolves to User as the concrete type
    id: "scalar-ID-User",
  });

  // Test with a patch
  const patchedFragment = proxy<unknown>(
    allDefinitions,
    scalars,
    "NodeFragment",
    { id: "custom-id" },
  );

  assertEquals(patchedFragment, {
    __typename: "User",
    id: "custom-id",
  });
});

Deno.test("operations > fragments > duplicate keys from multiple fragments", () => {
  const queryWithFragments = `
    query GetUsers {
      users {
        ...UserBasic
        ...UserContact
        ...UserFull
        id
      }
    }

    fragment UserBasic on User {
      id
      name
    }

    fragment UserContact on User {
      id
      email
    }

    fragment UserFull on User {
      name
      email
    }
  `;

  type GetUsersOp = {
    data: {
      users: Array<{
        __typename: "User";
        id: string;
        name: string;
        email: string;
      }>;
    };
  };

  const queryDefs = parse(queryWithFragments).definitions;
  const allDefs = [...definitions, ...queryDefs];

  const result = operation<GetUsersOp>(
    allDefs,
    scalars,
    queryWithFragments,
    { data: { users: [{}] } },
  );

  const firstUser = result.result.data?.users?.[0];
  assertEquals(firstUser, {
    __typename: "User",
    id: "scalar-ID-User",
    name: "scalar-String-User",
    email: "scalar-String-User",
  });

  const userKeys = Object.keys(firstUser || {});
  const uniqueKeys = [...new Set(userKeys)];

  assertEquals(
    userKeys.length,
    uniqueKeys.length,
    "Should have no duplicate keys",
  );
  assertEquals(userKeys.sort(), ["__typename", "email", "id", "name"].sort());
});
