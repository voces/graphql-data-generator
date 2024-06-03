# Builder functions

```ts
build.CreatePost(); // default all the way
build.CreatePost({ data: {}, variables: {}, refetch: true, optional: false }); //
build.CreatePost((ctx) => ({})); // Return is a patch, same as above, ctx TBD
build.CreatePost.transform(); // Calling a transform
build.CreatePost.variables({}); // variables built-in transform
build.CreatePost.variables((req, ctx) => ({})); // Can use a function, first arg is the simplified request, ctx TBD
build.CreatePost.data({}); // data built-in transform
build.CreatePost.data((req, ctx) => ({}));
build.CreatePost.patch({}); // patch built-in transform, combines variables & data
build.CreatePost.patch((req, ctx) => ({}));
const createPost = build.createPost({ variables: { title: "foo" } });
expect(createPost).toHaveBeenCalledWith({ title: "foo" }); // Can we have `toHaveBeenUsed`?
// Note this would require createPost.request to be the sam
createPost.clone({ variables: {} }); // Can clone a mock
```

<!-- Should build be required? What if it just works instead? Makes transforms off clone easier. -->
