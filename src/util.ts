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
