import { GraphQLError, Kind, parse } from "npm:graphql";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import {
  type Inputs,
  inputs,
  type Mutation,
  mutations,
  queries,
  type Query,
  type Subscription,
  subscriptions,
  type Types,
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

const build = init<
  Query,
  Mutation,
  Subscription,
  Types,
  Inputs,
  { extra: string }
>(
  schema,
  queries,
  mutations,
  subscriptions,
  types,
  inputs,
  scalars,
  {
    finalizeOperation: (op) => {
      if (!op.extra) return op;
      const originalResult = op.result;
      const nextResult = Object.assign(
        () => {
          nextResult.calls++;
          return originalResult;
        },
        originalResult,
      ) as unknown as typeof op["result"] & { calls: number };
      let calls = 0;
      Object.defineProperty(nextResult, "calls", {
        get: () => calls,
        set: (v) => calls = v,
      });
      op.result = nextResult;
      return op;
    },
  },
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
    coauthor: null,
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
      content: "Post by scalar-String-User",
      createdAt: "scalar-DateTime-Post",
      id: "scalar-ID-Post",
      title: "scalar-String-Post",
      coauthor: null,
    }],
    profilePicture: "https://example.com/scalar-ID-User.png",
    role: "ADMIN",
  });
});

Deno.test("objects > patched default values in next arrays", () => {
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({ Post: { default: { title: "Title!" } } }));
  assertEquals(
    build.User(
      { posts: { next: { title: (p) => `${p.title}1` } } },
      { posts: { next: { title: (p) => `${p.title}2` } } },
    ).posts.map((p) => p.title),
    ["Title!1", "Title!2"],
  );
});

Deno.test("objects > default values in nullable props", () => {
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({ User: { default: { name: "Tim" } } }));
  assertEquals(build.Post({ coauthor: {} }).coauthor?.name, "Tim");
});

Deno.test("objects > union types", () => {
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({ User: { default: { name: "Tim" } } }));
  assertEquals(build.SearchResult().__typename, "User");
  assertEquals(build.SearchResult().name, "Tim");
  assertEquals(build.SearchResult({ title: "Coerce" }).__typename, "Post");
});

Deno.test("objects > union types > default patch on union type", () => {
  // When the union type itself has a default patch with __typename,
  // it should use that type instead of the first member
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({
    SearchResult: { default: { __typename: "Post" } },
    Post: { default: { title: "Default Post Title" } },
  }));
  assertEquals(build.SearchResult().__typename, "Post");
  assertEquals(
    (build.SearchResult() as Types["Post"]).title,
    "Default Post Title",
  );
  // Can re-narrow to User by passing a User-specific field
  assertEquals(
    build.SearchResult({ email: "test@example.com" }).__typename,
    "User",
  );
  assertEquals(
    (build.SearchResult({ email: "test@example.com" }) as Types["User"]).email,
    "test@example.com",
  );
});

Deno.test("objects > union types > default patch on union type via field narrowing", () => {
  // When the union type itself has a default patch with a type-specific field,
  // it should narrow to that type
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({
    SearchResult: { default: { title: "Default Post Title" } },
  }));
  assertEquals(build.SearchResult().__typename, "Post");
  assertEquals(
    (build.SearchResult() as Types["Post"]).title,
    "Default Post Title",
  );
  // Can re-narrow to User by passing a User-specific field
  assertEquals(
    build.SearchResult({ email: "test@example.com" }).__typename,
    "User",
  );
});

Deno.test("objects > interface types", () => {
  assertEquals(build.Node().__typename, "User");
  assertEquals(build.Node({ title: "Coerce" }).__typename, "Post");
});

Deno.test("objects > unused fields", () => {
  assertEquals(Object.keys(build.UnusedHost()), ["__typename", "id"]);
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
        query: parse(
          await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        ),
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
        query: parse(
          await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        ),
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
        query: parse(
          await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        ),
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
        query: parse(
          await Deno.readTextFile("examples/board/queryWithVariables.gql"),
        ),
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

Deno.test("query > variable transform", () => {
  assertEquals(
    build.queryWithVariables.variables({ nonnullableScalar: "passed" })
      .request.variables?.nonnullableScalar,
    "passed",
  );
});

Deno.test("query > variable chained", () => {
  assertEquals(
    build.queryWithVariables({ data: { queryWithVariables: true } })
      .variables({ nonnullableScalar: "passed" })
      .variables((d, v) => ({
        nonnullableScalar: `${v.nonnullableScalar}2 ${d.queryWithVariables}`,
      }))
      .variables({ nonnullableScalar: (v) => `${v.nonnullableScalar}3` })
      .request.variables?.nonnullableScalar,
    "passed2 true3",
  );
});

Deno.test("query > data transform", () => {
  assertEquals(
    build.queryWithVariables.data({ queryWithVariables: true })
      .result.data?.queryWithVariables,
    true,
  );
});

Deno.test("query > data chained", () => {
  const q1 = build.queryWithVariables({
    variables: { nonnullableScalar: "passed" },
  });
  const q2 = q1.data({ queryWithVariables: true });
  const q3 = q2.data((_, d) => ({ queryWithVariables: !d.queryWithVariables }));
  const q4 = q3.data({ queryWithVariables: (d) => !d.queryWithVariables });
  const q5 = q1.data((v) => ({
    queryWithVariables: v.nonnullableScalar === "passed",
  }));
  assertEquals(
    [q1, q2, q3, q4, q5].map((q) => q.result.data?.queryWithVariables),
    [null, true, false, true, true],
  );
});

Deno.test("query > data > default object values", () => {
  const build = init<Query, Mutation, Subscription, Types, Inputs>(
    schema,
    queries,
    mutations,
    subscriptions,
    types,
    inputs,
    scalars,
  )(() => ({ User: { default: { name: "Bob" } } }));
  assertEquals(
    build.GetPosts({ data: { posts: [{}] } }).result.data?.posts[0].author.name,
    "Bob",
  );
  assertEquals(
    build.GetPosts({
      data: { posts: [{ author: { name: (p) => `${p.name}2` } }] },
    }).result.data?.posts[0].author.name,
    "Bob2",
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
        query: parse(
          await Deno.readTextFile("examples/board/Search.gql") + "\n\n" +
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

Deno.test("query > union aliased field narrowing", () => {
  // When a query has a union type with aliased fields,
  // narrowing should work with the alias name in the patch
  const result = build.SearchAliased({
    data: { search: [{ postTitle: "My Post" }] },
  });
  assertEquals(result.result.data?.search[0].__typename, "Post");
  assertEquals(
    (result.result.data?.search[0] as { postTitle: string }).postTitle,
    "My Post",
  );

  // Also verify narrowing to User
  const userResult = build.SearchAliased({
    data: { search: [{ userName: "John" }] },
  });
  assertEquals(userResult.result.data?.search[0].__typename, "User");
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
      if (
        value && typeof value === "object" &&
        (!("kind" in value) || value.kind !== Kind.DOCUMENT)
      ) {
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

Deno.test("query > retains extra data", () => {
  const mock = build.CreatePost({ extra: "foo" });
  assertEquals(mock.extra, "foo");
  assertEquals((mock.result as () => { data: unknown })().data, {
    createPost: {
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
  });
  assertEquals((mock.result as { calls: number }).calls, 1);
  assertEquals(mock.withAuthorId("id").extra, "foo");
});

Deno.test("query > errors returned as is", () => {
  const error = new Error("Oops");
  const errors = [new GraphQLError("Oops")];
  const mock = build.CreatePost({ error, errors });
  assertEquals(mock.error, error);
  assertEquals(mock.result.errors, errors);
});

Deno.test("mutation", async () => {
  assertEquals<OperationMockFromType<Mutation["CreatePost"]>>(
    build.CreatePost({ data: { createPost: { id: "post-id" } } })
      .withAuthorId("user-id"),
    {
      request: {
        query: parse(await Deno.readTextFile("examples/board/CreatePost.gql")),
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
        query: parse(
          await Deno.readTextFile("examples/board/OnPostCreated.gql"),
        ),
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

Deno.test("fragments", () => {
  // Create a build system that includes fragments with default and custom transforms
  const buildWithFragments = init<
    Query,
    Mutation,
    Subscription,
    Types & { NodeFragment: { __typename: string; id: string } }, // Add NodeFragment type
    Inputs
  >(
    schema,
    queries,
    mutations,
    subscriptions,
    // Add NodeFragment to types with the fields it contains
    { ...types, NodeFragment: ["__typename", "id"] },
    inputs,
    scalars,
  )(() => ({
    // Define transforms for NodeFragment
    NodeFragment: {
      // Default transform applied to all NodeFragment instances
      default: { id: "default-fragment-id" },

      // Custom transform method
      withCustomId: (_prev: unknown, customId: string) => ({
        id: `custom-${customId}`,
      }),

      // Another custom transform
      asPost: () => ({
        __typename: "Post",
        id: "post-fragment-id",
      }),
    },
  }));

  // Test that NodeFragment builder is available
  assertEquals("NodeFragment" in buildWithFragments, true);

  // Test basic fragment with default transform
  const nodeFragment = buildWithFragments.NodeFragment();

  assertObjectMatch(nodeFragment, {
    __typename: "User", // Resolves to User as concrete type
    id: "default-fragment-id", // Uses default transform
  });

  // Test with manual patch (overrides default)
  const patchedFragment = buildWithFragments.NodeFragment({
    id: "manual-override",
  });

  assertObjectMatch(patchedFragment, {
    __typename: "User",
    id: "manual-override",
  });

  // Test custom transform method
  const customFragment = buildWithFragments.NodeFragment().withCustomId(
    "test123",
  );

  assertObjectMatch(customFragment, {
    __typename: "User",
    id: "custom-test123",
  });

  // Test another custom transform that changes typename
  const postFragment = buildWithFragments.NodeFragment().asPost();

  assertObjectMatch(postFragment, {
    __typename: "Post",
    id: "post-fragment-id",
  });

  // Test chaining transforms
  const chainedFragment = buildWithFragments.NodeFragment()
    .withCustomId("chained")
    .patch({ __typename: "Post" });

  assertObjectMatch(chainedFragment, {
    __typename: "Post",
    id: "custom-chained",
  });
});

Deno.test("fragments > deduplication", async () => {
  // Create a scenario where the same fragment is imported by multiple operations
  // The fragment should only appear once in the combined definitions

  // Write temporary test files
  const tmpDir = await Deno.makeTempDir();

  const schemaContent = `
    type Query {
      user: User!
      post: Post!
    }
    type User {
      id: ID!
      name: String!
    }
    type Post {
      id: ID!
      title: String!
      author: User!
    }
  `;

  const fragmentContent = `
    fragment UserFields on User {
      id
      name
    }
  `;

  const query1Content = `
    #import "./UserFields.gql"
    query GetUser {
      user {
        ...UserFields
      }
    }
  `;

  const query2Content = `
    #import "./UserFields.gql"
    query GetPost {
      post {
        id
        title
        author {
          ...UserFields
        }
      }
    }
  `;

  await Deno.writeTextFile(`${tmpDir}/schema.graphql`, schemaContent);
  await Deno.writeTextFile(`${tmpDir}/UserFields.gql`, fragmentContent);
  await Deno.writeTextFile(`${tmpDir}/GetUser.gql`, query1Content);
  await Deno.writeTextFile(`${tmpDir}/GetPost.gql`, query2Content);

  const testSchema = await Deno.readTextFile(`${tmpDir}/schema.graphql`);

  type TestQuery = {
    GetUser: { data: { user: { id: string; name: string } } };
    GetPost: {
      data: {
        post: {
          id: string;
          title: string;
          author: { id: string; name: string };
        };
      };
    };
  };
  type TestTypes = {
    User: { id: string; name: string };
    Post: { id: string; title: string; author: { id: string; name: string } };
  };

  // This should not throw due to duplicate fragment definitions
  const testBuild = init<
    TestQuery,
    Record<string, never>,
    Record<string, never>,
    TestTypes,
    Record<string, never>
  >(
    testSchema,
    { GetUser: `${tmpDir}/GetUser.gql`, GetPost: `${tmpDir}/GetPost.gql` },
    {},
    {},
    { User: ["id", "name"], Post: ["id", "title", "author"] } as const,
    [],
    scalars,
  )(() => ({}));

  // If fragments are deduplicated properly, both operations should work
  // deno-lint-ignore no-explicit-any
  const userResult = testBuild.GetUser() as any;
  assertEquals(userResult.result.data.user.id, "scalar-ID-User");

  // deno-lint-ignore no-explicit-any
  const postResult = testBuild.GetPost() as any;
  assertEquals(postResult.result.data.post.author.id, "scalar-ID-User");

  // The key test: verify fragment definitions are NOT duplicated in the query documents
  // Both GetUser and GetPost import UserFields.gql, so without deduplication,
  // the fragment would appear multiple times when allDefinitions is constructed
  const userQueryFragments = userResult.request.query.definitions.filter(
    (d: { kind: string; name?: { value: string } }) =>
      d.kind === "FragmentDefinition" && d.name?.value === "UserFields",
  );
  assertEquals(
    userQueryFragments.length,
    1,
    `Expected 1 UserFields fragment in GetUser query, got ${userQueryFragments.length}`,
  );

  const postQueryFragments = postResult.request.query.definitions.filter(
    (d: { kind: string; name?: { value: string } }) =>
      d.kind === "FragmentDefinition" && d.name?.value === "UserFields",
  );
  assertEquals(
    postQueryFragments.length,
    1,
    `Expected 1 UserFields fragment in GetPost query, got ${postQueryFragments.length}`,
  );

  // Clean up
  await Deno.remove(tmpDir, { recursive: true });
});
