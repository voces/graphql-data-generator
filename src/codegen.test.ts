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
        status: Status
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
      bar: Boolean | null;
    };

    type MyInput = {
      foo: Foo | null;
      status: Status | null;
    };

    export type Inputs = {
      Foo: Foo;
      MyInput: MyInput;
    };

    export const inputs = ["Foo", "MyInput"] as const;

    export type Query = {
      MyQuery: {
        data: {
          myQuery: Boolean | null;
        };
        variables: {
          input?: MyInput | null;
        };
      };
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

    export type Query = {
      MyFoo: {
        data: {
          myFoo: {
            __typename: "Foo";
            bar: {
              __typename: "Bar";
              bar: Boolean | null;
            } | null;
          } | null;
        };
      };
    };

    export const queries = {
      MyFoo: "query.gql",
    };

    `),
  );
});
