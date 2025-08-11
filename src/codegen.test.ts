import { assertEquals } from "jsr:@std/assert";
import { codegen } from "./codegen.ts";

const trimIndent = (str: string) => {
  // Split the input string into lines
  const lines = str.split("\n");

  // Remove the first line if it’s empty
  if (lines[0].trim() === "") {
    lines.shift();
  }

  // Remove the last line if it’s empty
  if (lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  // Find the first non-empty line to determine the base indentation string
  const baseIndent =
    lines.find((line) => line.trim().length > 0)?.match(/^\s*/)?.[0] || "";

  // Trim the detected base indentation string from each line
  return lines
    .map((line) =>
      line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line
    )
    .join("\n");
};

Deno.test("nested input types", () => {
  assertEquals(
    codegen(
      `
      enum Status {
        Ignore
      }

      input Foo {
        bar: Boolean
      }
      
      input MyInput {
        foo: Foo
        status: Status!
      }

      type Query {
        myQuery(myInput: MyInput): Boolean
      }
      `,
      [{
        path: "query.gql",
        content: `
        query MyQuery($input: MyInput) {
          myQuery(myInput: $input)
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type Status = "Ignore";

    type Foo = {
      bar?: Boolean | null;
    };

    type MyInput = {
      foo?: Foo | null;
      status: Status;
    };

    export type Inputs = {
      Foo: Foo;
      MyInput: MyInput;
    };

    export const inputs = ["Foo", "MyInput"] as const;

    type MyQuery = {
      myQuery: Boolean | null;
    };

    type MyQueryVariables = {
      input?: MyInput | null;
    };

    export type Query = {
      MyQuery: { data: MyQuery; variables: MyQueryVariables; };
    };

    export const queries = {
      MyQuery: "query.gql",
    };

    `),
  );
});

Deno.test("nested types", () => {
  assertEquals(
    codegen(
      `
      type Baz {
        baz: Boolean
      }

      type Bar {
        bar: Boolean
        baz: Baz
      }
      
      type Foo {
        bar: Bar
      }

      type Query {
        myFoo: Foo
      }
      `,
      [{
        path: "query.gql",
        content: `
        query MyFoo {
          myFoo {
            bar {
              bar
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type Bar = {
      __typename: "Bar";
      bar: Boolean | null;
    };

    type Foo = {
      __typename: "Foo";
      bar: Bar | null;
    };

    export type Types = {
      Bar: Bar;
      Foo: Foo;
    };

    export const types = {
      Bar: ["bar"],
      Foo: ["bar"],
    } as const;

    type MyFoo = {
      myFoo: {
        __typename: "Foo";
        bar: {
          __typename: "Bar";
          bar: Boolean | null;
        } | null;
      } | null;
    };

    export type Query = {
      MyFoo: { data: MyFoo; };
    };

    export const queries = {
      MyFoo: "query.gql",
    };

    `),
  );
});

Deno.test("alias > query & type", () => {
  assertEquals(
    codegen(
      `
      type User {
        id: ID!
      }

      type Query {
        getUser(id: ID!): User!
      }
      `,
      [{
        path: "query.gql",
        content: `
        query User($id: ID!) {
          getUser(id: $id) {
            id
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type ID = string;

    type User = {
      __typename: "User";
      id: ID;
    };

    export type Types = {
      User: User;
    };

    export const types = {
      User: ["id"],
    } as const;

    type UserQuery = {
      getUser: {
        __typename: "User";
        id: ID;
      };
    };

    type UserQueryVariables = {
      id: ID;
    };

    export type Query = {
      User: { data: UserQuery; variables: UserQueryVariables; };
    };

    export const queries = {
      User: "query.gql",
    };

    `),
  );
});

Deno.test("alias > mutation & input", () => {
  assertEquals(
    codegen(
      `
      input User {
        id: ID!
      }

      type Mutation {
        validateUser(user: User!): Boolean!
      }
      `,
      [{
        path: "query.gql",
        content: `
        mutation User($user: User!) {
          validateUser(user: $user)
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type ID = string;

    type User = {
      id: ID;
    };

    export type Inputs = {
      User: User;
    };

    export const inputs = ["User"] as const;

    type UserMutation = {
      validateUser: Boolean;
    };

    type UserMutationVariables = {
      user: User;
    };

    export type Mutation = {
      User: { data: UserMutation; variables: UserMutationVariables; };
    };

    export const mutations = {
      User: "query.gql",
    };

    `),
  );
});

Deno.test("alias > query & subscription", () => {
  assertEquals(
    codegen(
      `
      type Query {
        user: Boolean!
      }

      type Subscription {
        user: Boolean!
      }
      `,
      [{
        path: "query.gql",
        content: `
        query User {
          user
        }
        `,
      }, {
        path: "subscription.gql",
        content: `
        subscription User {
          user
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type UserQuery = {
      user: Boolean;
    };

    export type Query = {
      User: { data: UserQuery; };
    };

    export const queries = {
      User: "query.gql",
    };

    type UserSubscription = {
      user: Boolean;
    };

    export type Subscription = {
      User: { data: UserSubscription; };
    };

    export const subscriptions = {
      User: "subscription.gql",
    };

    `),
  );
});

Deno.test("exports > types", () => {
  assertEquals(
    codegen(
      `
      type User {
        id: ID!
      }

      type Query {
        user: User
      }
      `,
      [{
        path: "getUser.gql",
        content: `
        query getUser {
          user {
            id
          }
        }
        `,
      }],
      { exports: ["types"] },
    ),
    trimIndent(`
    export type ID = string;

    export type User = {
      __typename: "User";
      id: ID;
    };

    export type Types = {
      User: User;
    };

    export const types = {
      User: ["id"],
    } as const;

    type getUser = {
      user: {
        __typename: "User";
        id: ID;
      } | null;
    };

    export type Query = {
      getUser: { data: getUser; };
    };

    export const queries = {
      getUser: "getUser.gql",
    };

    `),
  );
});

Deno.test("exports > operations", () => {
  assertEquals(
    codegen(
      `
      type User {
        id: ID!
      }

      type Query {
        user(id: ID): User
      }
      `,
      [{
        path: "getUser.gql",
        content: `
        query getUser($id: ID) {
          user(id: $id) {
            id
          }
        }
        `,
      }],
      { exports: ["operations"] },
    ),
    trimIndent(`
    type ID = string;

    type User = {
      __typename: "User";
      id: ID;
    };

    export type Types = {
      User: User;
    };

    export const types = {
      User: ["id"],
    } as const;

    export type getUser = {
      user: {
        __typename: "User";
        id: ID;
      } | null;
    };

    export type getUserVariables = {
      id?: ID | null;
    };

    export type Query = {
      getUser: { data: getUser; variables: getUserVariables; };
    };

    export const queries = {
      getUser: "getUser.gql",
    };

    `),
  );
});

Deno.test("enums > literals", () => {
  assertEquals(
    codegen(
      `
      enum Letter {
        A
        B
        C
      }

      type Query {
        letter: Letter
      }
      `,
      [{
        path: "getLetter.gql",
        content: `
        query getLetter {
          letter
        }
        `,
      }],
      { enums: "literals" },
    ),
    trimIndent(`
    type Letter = "A" | "B" | "C";

    type getLetter = {
      letter: Letter | null;
    };

    export type Query = {
      getLetter: { data: getLetter; };
    };

    export const queries = {
      getLetter: "getLetter.gql",
    };

    `),
  );
});

Deno.test("enums > none", () => {
  assertEquals(
    codegen(
      `
      enum Letter {
        A
        B
        C
      }

      type Query {
        letter: Letter
      }
      `,
      [{
        path: "getLetter.gql",
        content: `
        query getLetter {
          letter
        }
        `,
      }],
      { enums: "none" },
    ),
    trimIndent(`
    type getLetter = {
      letter: Letter | null;
    };

    export type Query = {
      getLetter: { data: getLetter; };
    };

    export const queries = {
      getLetter: "getLetter.gql",
    };

    `),
  );
});

Deno.test("enums > import", () => {
  assertEquals(
    codegen(
      `
      enum Letter {
        A
        B
        C
      }

      type Query {
        letter: Letter
      }
      `,
      [{
        path: "getLetter.gql",
        content: `
        query getLetter {
          letter
        }
        `,
      }],
      { enums: "import:foobar" },
    ),
    trimIndent(`
    import {
      Letter,
    } from "foobar";

    type getLetter = {
      letter: Letter | null;
    };

    export type Query = {
      getLetter: { data: getLetter; };
    };

    export const queries = {
      getLetter: "getLetter.gql",
    };

    `),
  );
});

Deno.test("schema", () => {
  assertEquals(
    codegen(
      `
      schema {
        query: Root
      }

      type Root {
        myQuery: Boolean!
      }
      `,
      [{
        path: "MyQuery.gql",
        content: `
        query MyQuery {
          myQuery
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type MyQuery = {
      myQuery: Boolean;
    };

    export type Query = {
      MyQuery: { data: MyQuery; };
    };

    export const queries = {
      MyQuery: "MyQuery.gql",
    };

    `),
  );
});

Deno.test("typesFile", () => {
  assertEquals(
    codegen(
      `
      type Query {
        myQuery: Boolean!
      }
      `,
      [{
        path: "MyQuery.gql",
        content: `
        query MyQuery {
          myQuery
        }
        `,
      }],
      { typesFile: "some/file.ts" },
    ),
    trimIndent(`
    import {
      MyQueryQuery,
    } from "some/file.ts";

    export type Query = {
      MyQuery: { data: MyQueryQuery; };
    };

    export const queries = {
      MyQuery: "MyQuery.gql",
    };

    `),
  );
});

Deno.test("typesFile > namingConvention", () => {
  assertEquals(
    codegen(
      `
      type WeirdCAPSOutput {
        weirdCAPSOutputField: ID!
      }

      input WeirdCAPSInput {
        weirdCAPSInputField: ID!
      }

      type Query {
        weirdCAPS(weirdCAPSArgument: WeirdCAPSInput): WeirdCAPSOutput
      }
      `,
      [{
        path: "MyQuery.gql",
        content: `
        query weirdCAPS($weirdCAPSVariable: WeirdCAPSInput) {
          weirdCAPS(weirdCAPSArgument: $weirdCAPSVariable) {
            weirdCAPSOutputField
          }
        }
        `,
      }],
      {
        typesFile: "some/file.ts",
        namingConvention: "change-case-all#pascalCase",
      },
    ),
    trimIndent(`
    import {
      WeirdCapsInput,
      WeirdCapsOutput,
      WeirdCapsQuery,
      WeirdCapsQueryVariables,
    } from "some/file.ts";
    
    export type Types = {
      WeirdCAPSOutput: WeirdCapsOutput;
    };
    
    export const types = {
      WeirdCAPSOutput: ["weirdCAPSOutputField"],
    } as const;
    
    export type Inputs = {
      WeirdCAPSInput: WeirdCapsInput;
    };
    
    export const inputs = ["WeirdCAPSInput"] as const;
    
    export type Query = {
      weirdCAPS: { data: WeirdCapsQuery; variables: WeirdCapsQueryVariables; };
    };
    
    export const queries = {
      weirdCAPS: "MyQuery.gql",
    };

    `),
  );
});

Deno.test("typesFile > omitOperationSuffix", () => {
  assertEquals(
    codegen(
      `
      type Query {
        myQuery: Boolean!
      }
      `,
      [{
        path: "MyQuery.gql",
        content: `
        query MyQuery {
          myQuery
        }
        `,
      }],
      { typesFile: "some/file.ts", omitOperationSuffix: true },
    ),
    trimIndent(`
    import {
      MyQuery,
    } from "some/file.ts";

    export type Query = {
      MyQuery: { data: MyQuery; };
    };

    export const queries = {
      MyQuery: "MyQuery.gql",
    };

    `),
  );
});

Deno.test("importing fragments & unions", () => {
  assertEquals(
    codegen(
      `
      type Foo {
        foo: Boolean!
      }

      type Bar {
        bar: Boolean!
      }

      union Thing = Foo | Bar

      type Container {
        thing: Thing!
      }
      
      type Query {
        container: Container!
      }
      `,
      [{
        path: "FooFragment.gql",
        content: `
          fragment FooFragment on Foo {
            foo
          }
        `,
      }, {
        path: "query.gql",
        content: `
        #import "./FooFragment.gql"

        query myThing {
          container {
            thing {
              ...FooFragment
              ... on Bar {
                bar
              }
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type FooFragment = {
      foo: Boolean;
      __typename: "Foo";
    };

    type Foo = {
      __typename: "Foo";
      foo: Boolean;
    };

    type Bar = {
      __typename: "Bar";
      bar: Boolean;
    };

    type Thing = Foo | Bar;

    type Container = {
      __typename: "Container";
      thing: Thing;
    };

    export type Types = {
      FooFragment: FooFragment;

      Foo: Foo;
      Bar: Bar;
      Thing: Thing;
      Container: Container;
    };

    export const types = {
      FooFragment: ["foo"],

      Foo: ["foo"],
      Bar: ["bar"],
      Thing: [],
      Container: ["thing"],
    } as const;

    type myThing = {
      container: {
        __typename: "Container";
        thing: {
          __typename: "Foo";
          foo: Boolean;
        } | {
          __typename: "Bar";
          bar: Boolean;
        };
      };
    };

    export type Query = {
      myThing: { data: myThing; };
    };

    export const queries = {
      myThing: "query.gql",
    };

    `),
  );
});

Deno.test("deeply nested union merging issue", () => {
  assertEquals(
    codegen(
      `
      union Content = TextContent
      union Content = ImageContent

      type TextContent {
        id: ID!
        text: String!
      }

      type ImageContent {
        id: ID!
        url: String!
      }

      type Post {
        id: ID!
        title: String!
        contentList: [Content!]!
      }

      type Query {
        posts: [Post!]!
      }
      `,
      [{
        path: "posts.gql",
        content: `
        query GetPosts {
          posts {
            id
            title
            contentList {
              ... on TextContent {
                id
                text
              }
              ... on ImageContent {
                id
                url
              }
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type String = string;

    type ID = string;

    type Content = ImageContent;

    type ImageContent = {
      __typename: "ImageContent";
      id: ID;
      url: String;
    };

    type Post = {
      __typename: "Post";
      id: ID;
      title: String;
      contentList: Content[];
    };

    export type Types = {
      Content: Content;
      ImageContent: ImageContent;
      Post: Post;
    };

    export const types = {
      Content: [],
      ImageContent: ["id", "url"],
      Post: ["id", "title", "contentList"],
    } as const;

    type GetPosts = {
      posts: {
        __typename: "Post";
        id: ID;
        title: String;
        contentList: ({
          __typename: "TextContent";
          id: ID;
          text: String;
        } | {
          __typename: "ImageContent";
          id: ID;
          url: String;
        })[];
      }[];
    };

    export type Query = {
      GetPosts: { data: GetPosts; };
    };

    export const queries = {
      GetPosts: "posts.gql",
    };

    `),
  );
});

Deno.test("union type merging prevention", () => {
  assertEquals(
    codegen(
      `
      union SearchResult = User
      union SearchResult = Post

      type User {
        id: ID!
        name: String!
      }

      type Post {
        id: ID!
        title: String!
      }

      type Query {
        search: SearchResult!
      }
      `,
      [{
        path: "search.gql",
        content: `
        query Search {
          search {
            ... on User {
              id
              name
            }
            ... on Post {
              id
              title
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type String = string;

    type ID = string;

    type SearchResult = Post;

    type Post = {
      __typename: "Post";
      id: ID;
      title: String;
    };

    export type Types = {
      SearchResult: SearchResult;
      Post: Post;
    };

    export const types = {
      SearchResult: [],
      Post: ["id", "title"],
    } as const;

    type Search = {
      search: {
        __typename: "User";
        id: ID;
        name: String;
      } | {
        __typename: "Post";
        id: ID;
        title: String;
      };
    };

    export type Query = {
      Search: { data: Search; };
    };

    export const queries = {
      Search: "search.gql",
    };

    `),
  );
});

Deno.test("exhaustive union interface types", () => {
  assertEquals(
    codegen(
      `
      interface Node {
        id: String!
      }

      type User implements Node {
        id: String!
        user: String!
      }

      type Post implements Node {
        id: String!
        post: String!
      }

      union NodeType = User | Post

      type Query {
        node: NodeType!
      }
      `,
      [{
        path: "NodeFragment.gql",
        content: `
          fragment NodeFragment on Node {
            id
          }
        `,
      }, {
        path: "query.gql",
        content: `
        #import "./NodeFragment.gql"

        query myNode {
          node {
            ...NodeFragment
            ... on User {
              user
            }
            ... on Post {
              post
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type String = string;

    type NodeFragment = {
      id: String;
    };

    type User = {
      __typename: "User";
      id: String;
      user: String;
    };

    type Post = {
      __typename: "Post";
      id: String;
      post: String;
    };

    type NodeType = User | Post;

    export type Types = {
      NodeFragment: NodeFragment;

      User: User;
      Post: Post;
      NodeType: NodeType;
    };

    export const types = {
      NodeFragment: ["id"],

      User: ["id", "user"],
      Post: ["id", "post"],
      NodeType: [],
    } as const;

    type myNode = {
      node: {
        id: String;
      } & ({
        __typename: "User";
        user: String;
      } | {
        __typename: "Post";
        post: String;
      });
    };

    export type Query = {
      myNode: { data: myNode; };
    };

    export const queries = {
      myNode: "query.gql",
    };

    `),
  );
});

Deno.test("union fragments with discriminated types", () => {
  assertEquals(
    codegen(
      `
      union Content = TextContent | ImageContent

      type TextContent {
        id: ID!
        text: String!
      }

      type ImageContent {
        id: ID!
        url: String!
      }

      type Post {
        id: ID!
        content: Content!
      }

      type Query {
        posts: [Post!]!
      }
      `,
      [{
        path: "fragments.gql",
        content: `
        fragment TextFragment on TextContent {
          id
          text
        }
        
        fragment ImageFragment on ImageContent {
          id
          url
        }
        `,
      }, {
        path: "query.gql",
        content: `
        #import "./fragments.gql"
        
        query GetPosts {
          posts {
            id
            content {
              ...TextFragment
              ...ImageFragment
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type String = string;

    type ID = string;

    type TextFragment = {
      id: ID;
      text: String;
      __typename: "TextContent";
    };

    type ImageFragment = {
      id: ID;
      url: String;
      __typename: "ImageContent";
    };

    type Content = TextContent | ImageContent;

    type TextContent = {
      __typename: "TextContent";
      id: ID;
      text: String;
    };

    type ImageContent = {
      __typename: "ImageContent";
      id: ID;
      url: String;
    };

    type Post = {
      __typename: "Post";
      id: ID;
      content: Content;
    };

    export type Types = {
      TextFragment: TextFragment;
      ImageFragment: ImageFragment;

      Content: Content;
      TextContent: TextContent;
      ImageContent: ImageContent;
      Post: Post;
    };

    export const types = {
      TextFragment: ["id", "text"],
      ImageFragment: ["id", "url"],

      Content: [],
      TextContent: ["id", "text"],
      ImageContent: ["id", "url"],
      Post: ["id", "content"],
    } as const;

    type GetPosts = {
      posts: {
        __typename: "Post";
        id: ID;
        content: {
          __typename: "TextContent";
          id: ID;
          text: String;
        } | {
          __typename: "ImageContent";
          id: ID;
          url: String;
        };
      }[];
    };

    export type Query = {
      GetPosts: { data: GetPosts; };
    };

    export const queries = {
      GetPosts: "query.gql",
    };

    `),
  );
});
Deno.test("nested fragments export all referenced types", () => {
  assertEquals(
    codegen(
      `
      union Content = Article | Video

      type Article {
        id: ID!
        title: String!
      }

      type Video {
        id: ID!
        url: String!
      }

      type Query {
        content: Content!
      }
      `,
      [{
        path: "fragments.gql",
        content: `
        fragment ArticleFragment on Article {
          id
          title
        }
        
        fragment VideoFragment on Video {
          id
          url
        }
        `,
      }, {
        path: "query.gql",
        content: `
        #import "./fragments.gql"
        
        fragment ContentFragment on Content {
          ... on Article {
            ...ArticleFragment
          }
          ... on Video {
            ...VideoFragment
          }
        }
        
        query GetContent {
          content {
            ...ContentFragment
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type String = string;

    type ID = string;

    type ArticleFragment = {
      id: ID;
      title: String;
      __typename: "Article";
    };

    type VideoFragment = {
      id: ID;
      url: String;
      __typename: "Video";
    };

    type ContentFragment = {
      id: ID;
      title: String;
      __typename: "Article";
    } | {
      id: ID;
      url: String;
      __typename: "Video";
    };

    type Content = Article | Video;

    type Article = {
      __typename: "Article";
      id: ID;
      title: String;
    };

    type Video = {
      __typename: "Video";
      id: ID;
      url: String;
    };

    export type Types = {
      ArticleFragment: ArticleFragment;
      VideoFragment: VideoFragment;
      ContentFragment: ContentFragment;

      Content: Content;
      Article: Article;
      Video: Video;
    };

    export const types = {
      ArticleFragment: ["id", "title"],
      VideoFragment: ["id", "url"],
      ContentFragment: ["id", "title", "url"],

      Content: [],
      Article: ["id", "title"],
      Video: ["id", "url"],
    } as const;

    type GetContent = {
      content: {
        __typename: "Article";
        id: ID;
        title: String;
      } | {
        __typename: "Video";
        id: ID;
        url: String;
      };
    };

    export type Query = {
      GetContent: { data: GetContent; };
    };

    export const queries = {
      GetContent: "query.gql",
    };

    `),
  );
});
