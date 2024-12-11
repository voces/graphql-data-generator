# 0.2.0

- **[Breaking]** Renamed `useEnums` to `enums` in the CLI and code generation.
  The `enums` option now supports the following values: `enums`, `literals`,
  `import`, and `none`. The default value is now `literals`.
- **[Breaking]** Changed the exports format.
- **[feat]** Added the `banner` argument to the CLI.
- **[feat]** Added plugin support for
  [`@graphql-codegen`](https://the-guild.dev/graphql/codegen/docs/getting-started).
- **[feat]** Added the `typesFile` argument to the CLI and `codegen`.
- **[feat]** Added pluck to support operations defined in non-GQL files.
- **[bugfix]** Fixed using a `__typename` union discriminator.
