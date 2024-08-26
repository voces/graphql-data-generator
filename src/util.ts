export const raise = (error: Error | string) => {
  if (typeof error === "string") throw new Error(error);
  throw error;
};

export const formatCode = async (input: string): Promise<string> => {
  // Create the deno fmt subprocess
  const process = new Deno.Command("deno", {
    args: ["fmt", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Get the writable stream to the subprocess's stdin
  const writer = process.stdin.getWriter();

  // Write the input string to the subprocess's stdin
  await writer.write(new TextEncoder().encode(input));
  await writer.close();

  // Read the formatted output from the subprocess's stdout
  const output = await process.output();

  if (output.success) {
    const formattedString = new TextDecoder().decode(output.stdout);
    return formattedString;
  } else return input;
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
  if (Array.isArray(obj)) {
    return obj.map(toObject) as NonNever<StripFunctions<T>>;
  }
  if (typeof obj !== "object" || !obj) {
    return obj as NonNever<StripFunctions<T>>;
  }
  const clone: Partial<T> = {};
  for (const key in obj) {
    if (typeof obj[key] !== "function") clone[key] = obj[key];
  }
  return clone as NonNever<StripFunctions<T>>;
};
