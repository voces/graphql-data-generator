import { exec } from "node:child_process";

export const raise = (error: Error | string) => {
  if (typeof error === "string") throw new Error(error);
  throw error;
};

export const formatCode = async (input: string): Promise<string> => {
  try {
    return await new Promise<string>((resolve, reject) => {
      const process = exec("deno fmt -", (error, stdout, stderr) => {
        if (error) return reject(error);
        if (stderr) return reject(new Error(stderr));
        resolve(stdout);
      });
      process.stdin?.write(input);
      process.stdin?.end();
    });
  } catch {
    return input;
  }
};

export const absurd = (v: never) => {
  const error = new Error(`Unexpected value: ${v}`);
  Error.captureStackTrace(error, absurd);
  throw error;
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
  const clone: Partial<T> = {};
  for (const key in obj) {
    if (typeof obj[key] !== "function") {
      clone[key] = toObject(obj[key]) as T[Extract<keyof T, string>];
    }
  }
  return clone as NonNever<StripFunctions<T>>;
};
