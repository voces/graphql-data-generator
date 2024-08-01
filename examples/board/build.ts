// import { init } from "../../src/index.ts";
// import { Patch } from "../../src/types.ts";

import { parse } from "npm:graphql";
import { proxy } from "../../src/proxy.ts";
import { Types } from "./types.ts";

// import {
//   Inputs,
//   inputs,
//   Mutations,
//   mutations,
//   Queries,
//   queries,
//   Subscriptions,
//   subscriptions,
//   Types,
//   types,
// } from "./types.ts";

// const schema = await Deno.readTextFile("examples/board/schema.graphql");

// const indexes: Record<string, number> = {};
// const incObjectIndex = (object: string) => {
//   const current = indexes[object] ?? 0;
//   indexes[object] = (indexes[object] ?? 0) + 1;
//   return current;
// };

// const build = init<Queries, Mutations, Subscriptions, Types, Inputs>(
//   schema,
//   queries,
//   mutations,
//   subscriptions,
//   types,
//   inputs,
//   {
//     ID: (o) => `${o}-${incObjectIndex(o)}`,
//     DateTime: "2024-05-29T00:00:00.000",
//     String: "",
//   },
// )((b) => ({
//   CreatePost: {
//     default: (a) => {
//       console.log("a", a.data.createPost.author.name);
//       return {};
//     },
//   },
//   // CreatePost: {
//   //   default: {
//   //     data: {
//   //       createPost: {
//   //         title: (_p, v) => {
//   //           console.log("_p", _p.author.email);
//   //           return v.input?.title ?? "Title";
//   //         },
//   //         content: (_p, v) => v.input?.content ?? "Content",
//   //         author: (_p, v) =>
//   //           v.input?.authorId
//   //             ? b.User.findBy(v.input.authorId) ??
//   //               { id: v.input.authorId }
//   //             : { id: v.input?.authorId },
//   //       },
//   //     },
//   //   },
//   //   withAuthor: (_, author: Patch<Types["User"]>) => ({
//   //     data: { createPost: { author } },
//   //   }),
//   // },
//   GetPosts: {
//     default: {
//       data: { posts: () => b.Post.all },
//     },
//     withPost: (_, post: Patch<Types["Post"]>) => ({
//       data: { posts: { next: post } },
//     }),
//   },
//   Post: {
//     default: {
//       id: () => `post-${b.Post.length}`,
//       title: (p) => `Title-${p.id ?? b.Post.length}`,
//       content: (p) => b.Post.findBy(p.id)?.title ?? "Content",
//       author: {
//         name: (p) => p.author?.name ?? "Yo",
//         // bar: 7, // BAD
//       },
//       // extra: 3, // BAD
//     },
//     withAuthor: ((_, author: Patch<Types["User"]>) => ({ author })),
//   },
//   GetNode: {
//     default: {
//       // Should be allowed to be unset..., but would need to continue instead of else-if
//       variables: {
//         id: () => b.Post.last?.id ?? b.User.last?.id,
//         // extra: "foo", // BAD
//       },
//       data: {
//         node: {
//           id: (_n, v) => v.id,
//         },
//       },
//     },
//   },
// }));

// console.log(
//   build.CreatePost({
//     variables: { input: { authorId: "author-1" } },
//     // data: { createPost: { author: { name: "Foo" } } },
//   }),
//   // build.CreatePost({ data: { createPost: { content: "Foo" } } })
//   //   .withAuthor({ email: "bob@example.com" })
//   //   .withAuthor({ name: "Bob" })
//   //   .patch({
//   //     data: {
//   //       createPost: {
//   //         title: () => {
//   //           return "Bar";
//   //         },
//   //       },
//   //     },
//   //   }),
// );

// // console.log(build.User.findBy("author-1"));

// // console.log(build.Post.all);
// // console.log(build.User.all);

// // console.log(build.GetNode());
// // const createPost1 = build.CreatePost();
// // const createPost1 = build.CreatePost({ variables: { input: {} } });
// // const createPost2 = build.CreatePost.withAuthor(build.User()).default();
// // const createPost2 = build.CreatePost
// //   .variables({ input: { title: "Yoo" } })
// //   .data((v) => ({ createPost: { title: v.input?.title } })); // title is non-nullable, but our input value is, so we fallback to old value if input is null
// // const createPost3 = build.CreatePost.patch({
// //   variables: { input: { title: "Yoo" } },
// //   data: { createPost: { title: "Yoo" } },
// // });
// // const createPost4 = createPost3.clone();
// // const createPost5 = build.CreatePost.last?.clone();

// // build.Post.findBy("0", "title");

// // Simple
// // build.CreatePost();
// // build.CreatePost({})

const schema = await Deno.readTextFile("examples/board/schema.graphql");
const { definitions } = parse(schema);
const ids: Record<string, number | undefined> = {};
const scalars = {
  ID: (typename: string) =>
    `${typename}-${ids[typename] = (ids[typename] ?? -1) + 1}`,
  DateTime: () => new Date().toISOString(),
  String: "",
};

console.log(
  proxy<Types["Post"]>(
    definitions,
    "Query.posts",
    scalars,
    { id: "yo" },
    // { author: { name: "heh" } },
  ).id,
);

// console.log(
//   proxy<Types["Post"]>(definitions, "Query.node", scalars, { id: "yo" }, {
//     author: { name: "heh" },
//   }),
// );
