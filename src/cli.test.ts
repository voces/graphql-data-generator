import { assertEquals } from "jsr:@std/assert";

Deno.test("banner > file", async () => {
  const cmd = new Deno.Command("deno", {
    args: [
      "-A",
      "src/cli.ts",
      "--schema=examples/board/schema.graphql",
      "--operations=examples/board",
      "--scalar=DateTime:string",
      "--scalar=URL:string",
      "--banner=.gitignore",
    ],
  });
  const gitignore = await Deno.readTextFile(".gitignore");
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0);
  assertEquals(
    new TextDecoder().decode(stdout).slice(0, gitignore.length),
    gitignore,
  );
});

Deno.test("banner > copy", async () => {
  const banner = "Hello, World!\n";
  const cmd = new Deno.Command("deno", {
    args: [
      "-A",
      "src/cli.ts",
      "--schema=examples/board/schema.graphql",
      "--operations=examples/board",
      "--scalar=DateTime:string",
      "--scalar=URL:string",
      `--banner=${banner}`,
    ],
  });
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0);
  assertEquals(
    new TextDecoder().decode(stdout).slice(0, banner.length),
    banner,
  );
});
