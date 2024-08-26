import { __Type, GraphQLError, parse } from "npm:graphql";
import { operation, proxy } from "./proxy.ts";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { Inputs, Mutation, Query, Types } from "../examples/board/types.ts";

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const { definitions } = parse(schema);
const scalars = new Proxy({}, {
  get: (_, prop) => (t: string) => {
    if (t === "String") console.log("???", new Error().stack);
    return `scalar-${prop.toString()}-${t}`;
  },
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

Deno.test("objects > interfaces > can resolve an inteface with a field hint", () => {
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
    proxy(definitions, scalars, "CreatePostAndUpdateUser"),
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

Deno.test("operations > queries > nonnullableScalar", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = { data: { nonnullableScalar: string } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query },
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
    request: { query },
    result: { data: { nullableScalar: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableScalar: "ok" },
    }),
    { request: { query }, result: { data: { nullableScalar: "ok" } } },
  );
});

Deno.test("operations > queries > nonnullableNonnullableScalars", () => {
  const query = "query Foo { nonnullableNonnullableScalars }";
  type Operation = { data: { nonnullableNonnullableScalars: string[] } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query },
    result: { data: { nonnullableNonnullableScalars: [] } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: ["foo"] },
    }),
    {
      request: { query },
      result: { data: { nonnullableNonnullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { 1: "foo" } },
    }),
    {
      request: { query },
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
      request: { query },
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
      request: { query },
      result: { data: { nonnullableNonnullableScalars: ["foo", "foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nonnullableNonnullableScalars: { last: "bar" } },
    }),
    {
      request: { query },
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
      request: { query },
      result: { data: { nonnullableNonnullableScalars: ["bar"] } },
    },
  );
});

Deno.test("operations > queries > nullableNonnullableScalars", () => {
  const query = "query Foo { nullableNonnullableScalars }";
  type Operation = { data: { nullableNonnullableScalars: string[] | null } };

  assertEquals(operation<Operation>(definitions, scalars, query), {
    request: { query },
    result: { data: { nullableNonnullableScalars: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: [] },
    }),
    {
      request: { query },
      result: { data: { nullableNonnullableScalars: [] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: ["foo"] },
    }),
    {
      request: { query },
      result: { data: { nullableNonnullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNonnullableScalars: { 1: "foo" } },
    }),
    {
      request: { query },
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
    request: { query },
    result: { data: { nullableNullableScalars: null } },
  });

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: [] },
    }),
    {
      request: { query },
      result: { data: { nullableNullableScalars: [] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: ["foo"] },
    }),
    {
      request: { query },
      result: { data: { nullableNullableScalars: ["foo"] } },
    },
  );

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      data: { nullableNullableScalars: { 1: "foo" } },
    }),
    {
      request: { query },
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
      request: { query },
      result: { data: { nonnullableNonnullableNonnullableScalars: [] } },
    });

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nonnullableNonnullableNonnullableScalars: [] },
      }),
      {
        request: { query },
        result: { data: { nonnullableNonnullableNonnullableScalars: [] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nonnullableNonnullableNonnullableScalars: [["foo"]] },
      }),
      {
        request: { query },
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
        request: { query },
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
      request: { query },
      result: { data: { nullableNullableNullableScalars: null } },
    });

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: [] },
      }),
      {
        request: { query },
        result: { data: { nullableNullableNullableScalars: [] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: [["foo"]] },
      }),
      {
        request: { query },
        result: { data: { nullableNullableNullableScalars: [["foo"]] } },
      },
    );

    assertEquals(
      operation<Operation>(definitions, scalars, query, {
        data: { nullableNullableNullableScalars: { 1: { 1: "foo" } } },
      }),
      {
        request: { query },
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
    request: { query },
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

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      error: new Error("oops"),
    }),
    { request: { query }, result: {}, error: new Error("oops") },
  );
});

Deno.test("operations > queries > errors", () => {
  const query = "query Foo { nonnullableScalar }";
  type Operation = {
    data: { nonnullableScalar: string };
    errors: GraphQLError[];
  };

  assertEquals(
    operation<Operation>(definitions, scalars, query, {
      errors: [new GraphQLError("oops")],
    }),
    {
      request: { query },
      result: {
        // TODO: Should allow and default to null data if errors present, unless
        // patched in
        data: { nonnullableScalar: "scalar-String-Query" },
        errors: [new GraphQLError("oops")],
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
        query,
        variables: {
          input: {
            email: "scalar-String-CreateUserInput",
            name: "name",
            role: "ADMIN",
            // TODO: should be optional
            profilePicture: null,
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

// operations > subscriptions
// scalar list?
// interface list?
// union list?
