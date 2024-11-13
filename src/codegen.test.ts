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
      { scalars: { Boolean: "boolean" } },
    ),
    trimIndent(`
    type Boolean = boolean;

    enum Status {
      Ignore,
    }

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
      { scalars: { Boolean: "boolean" } },
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
      { scalars: { ID: "string" } },
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
      { scalars: { Boolean: "boolean", ID: "string" } },
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
      { scalars: { Boolean: "boolean" } },
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
      { scalars: { ID: "string" }, exports: ["types"] },
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
      { scalars: { ID: "string" }, exports: ["operations"] },
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
