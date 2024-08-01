import { parse } from "npm:graphql";
import { proxy } from "./proxy.ts";
import { assertEquals } from "jsr:@std/assert";
import { Types } from "../examples/board/types.ts";
import { serialize } from "./util.ts";

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const { definitions } = parse(schema);
const ids: Record<string, number | undefined> = {};
const scalars = new Proxy({}, {
  get: (_, prop) => (t: string) => `scalar-${prop.toString()}-${t}`,
  has: () => true,
});

Deno.test("objects", async (t) => {
  await t.step("simple object generation", () => {
    assertEquals(
      serialize(
        proxy<Types["Post"]>(
          definitions,
          "Post",
          scalars,
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
        },
      },
    );
  });

  await t.step("overwrite field", () => {
    assertEquals(
      serialize(
        proxy<Types["User"]>(definitions, "User", scalars, { id: "my-id" }),
      ),
      {
        __typename: "User",
        id: "my-id",
        createdAt: "scalar-DateTime-User",
        name: "scalar-String-User",
        email: "scalar-String-User",
        role: "ADMIN",
        profilePicture: null,
      },
    );
  });

  await t.step("overwrite the same field twice", () => {
    assertEquals(
      serialize(
        proxy<Types["User"]>(
          definitions,
          "User",
          scalars,
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
      },
    );
  });

  await t.step("overwrite diffeent field sets", () => {
    assertEquals(
      serialize(
        proxy<Types["User"]>(
          definitions,
          "User",
          scalars,
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
      },
    );
  });

  await t.step("overwrite with functions", () => {
    assertEquals(
      serialize(
        proxy<Types["User"]>(
          definitions,
          "User",
          scalars,
          {
            id: (u) => {
              assertEquals(serialize(u), {
                // __typename: "User",
                // id: "my-id",
                // createdAt: "scalar-DateTime-User",
                // name: "my-name",
                // email: "scalar-String-User",
                // role: "ADMIN",
                // profilePicture: null,
              } as any);
              return "my-id";
            },
          },
          { name: (u) => "my-name" },
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
      },
    );
  });

  // await t.step("individual fields with multiple patches", () => {
  //   assertEquals(
  //     proxy<Types["Post"]>(definitions, "Post", scalars, { id: "my-id-1" }, {
  //       id: "my-id-2",
  //     })
  //       .id,
  //     "my-id-2",
  //   );
  // });

  // await t.step("matching multiple different fields", () => {
  //   const post = proxy<Types["Post"]>(
  //     definitions,
  //     "Post",
  //     scalars,
  //     { id: "my-id" },
  //     { content: "my-content" },
  //   );
  //   assertEquals(post.id, "my-id");
  //   assertEquals(post.content, "my-content");
  // });
});
