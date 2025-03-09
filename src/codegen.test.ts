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

    export const types = ["Bar", "Foo"] as const;

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

    export const types = ["User"] as const;

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

    export const types = ["User"] as const;

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

    export const types = ["User"] as const;

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
    
    export const types = ["WeirdCAPSOutput"] as const;
    
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
      
      type Query {
        thing: Thing!
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
          thing {
            ...FooFragment
            ... on Bar {
              bar
            }
          }
        }
        `,
      }],
    ),
    trimIndent(`
    type Boolean = boolean;

    type Foo = {
      __typename: "Foo";
      foo: Boolean;
    };

    type Bar = {
      __typename: "Bar";
      bar: Boolean;
    };

    export type Types = {
      Foo: Foo;
      Bar: Bar;
    };

    export const types = ["Foo", "Bar"] as const;

    type myThing = {
      thing: {
        __typename: "Foo";
        foo: Boolean;
      } | {
        __typename: "Bar";
        bar: Boolean;
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
