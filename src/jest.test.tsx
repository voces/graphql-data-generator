import "./jest.polyfill.test.ts";

import { useEffect } from "npm:react";
import { MockedProvider } from "./jest.tsx";
import {
  gql,
  useApolloClient,
  useMutation,
  useQuery,
} from "npm:@apollo/client";
import { render } from "npm:@testing-library/react";
import { GlobalRegistrator } from "npm:@happy-dom/global-registrator";
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
import { afterEach, beforeEach, it } from "jsr:@std/testing/bdd";

beforeEach(() => {
  GlobalRegistrator.register({
    url: "http://localhost:3000",
    width: 1920,
    height: 1080,
  });
});

afterEach(async () => {
  await GlobalRegistrator.unregister();
});

const idCounts: Record<string, number | undefined> = {};
const idScalar = (typename: string) => {
  if (!idCounts[typename]) idCounts[typename] = 0;
  return `${typename}-${idCounts[typename]++}`;
};

const schema = await Deno.readTextFile("examples/board/schema.graphql");
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
  { ID: idScalar, String: "", DateTime: "2025-02-16T23:42:22.612Z" },
)(() => ({}));

const GET_USERS = gql(await Deno.readTextFile("examples/board/GetUsers.gql"));
const GET_USER_POSTS = gql(
  await Deno.readTextFile("examples/board/GetUserPosts.gql"),
);
const CREATE_POST = gql(
  await Deno.readTextFile("examples/board/CreatePost.gql"),
);

it("MockedProvider smoke", () => {
  const Component = () => {
    useQuery(GET_USERS);
    useQuery(GET_USER_POSTS, { variables: { id: "user-1" } });
    const [createPost] = useMutation<
      Mutation["CreatePost"]["data"],
      Mutation["CreatePost"]["variables"]
    >(CREATE_POST, {
      refetchQueries: ["GetUsers"],
    });
    const client = useApolloClient();
    useEffect(() => {
      client.query({ query: GET_USER_POSTS, variables: { id: "user-2" } });
      createPost({
        variables: { input: { authorId: "user-1", title: "", content: "" } },
      });
    }, []);
    return null;
  };
  const getUserPosts = build.GetUserPosts({ variables: { id: "user-1" } });
  render(
    <MockedProvider
      mocks={[
        build.GetUsers(),
        getUserPosts,
        getUserPosts.variables({ id: "user-2" }),
        build.CreatePost({ variables: { input: { authorId: "user-1" } } }),
        build.GetUsers(),
      ]}
      stack={new Error().stack}
    >
      <Component />
    </MockedProvider>,
  );
});
