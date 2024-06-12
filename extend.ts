const foo: { a: string } = { a: "foo" };

const extend = function <T, U>(_v: T, u: U): asserts _v is T & U {};

extend(foo, { b: 5 });

// foo.
