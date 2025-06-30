export const raise = (error: Error | string) => {
  if (typeof error === "string") {
    const err = new Error(error);
    Error.captureStackTrace(err, raise);
    throw err;
  }
  throw error;
};

export const absurd = (v: never) => {
  const error = new Error(`Unexpected value: ${v}`);
  Error.captureStackTrace(error, absurd);
  throw error;
};

const isPlainObject = (value: unknown) => {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value as object);
  return proto === Object.prototype || proto === null;
};

type StripFunctions<T> = {
  // deno-lint-ignore no-explicit-any
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never
    : T[K] extends object ? StripFunctions<T[K]>
    : T[K];
};
// Remove `never` properties
type NonNever<T> = Pick<
  T,
  { [K in keyof T]: T[K] extends never ? never : K }[keyof T]
>;
export const toObject = <T>(
  obj: T,
): NonNever<StripFunctions<T>> => {
  if (typeof obj !== "object" || !obj) {
    return obj as NonNever<StripFunctions<T>>;
  }
  if (Array.isArray(obj)) {
    return obj.map(toObject) as NonNever<StripFunctions<T>>;
  }
  if (!isPlainObject(obj)) return obj as NonNever<StripFunctions<T>>;
  const clone: Partial<T> = {};
  for (const key in obj) {
    if (typeof obj[key] !== "function") {
      clone[key] = toObject(obj[key]) as T[Extract<keyof T, string>];
    }
  }
  return clone as NonNever<StripFunctions<T>>;
};
