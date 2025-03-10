# 0.3.1

- **[feat]** Add type generation support for union and interface types.
- **[bugfix]** Generated types handles fragments in unions.
- **[bugfix]** Fixed require export path.
- **[bugfix]** Fixed caching of imports that also have imports.

# 0.3.0

- **[Breaking]** Added a universal `patch` transform for built operations, which
  is now automatically applied to all operations.
- **[feat]** Introduced a new `MockProvider` to improve error messaging for
  missing mocks and to assert on unused mocks. Also added configuration options:
  `skipCleanupAfterEach`, `failRefetchWarnings`, `allowMissingMocks`, and
  `waitForMocks`.
- **[feat]** Added a new `stack` property to `OperationMock`, automatically set
  during operation creation. Additionally, introduced `watch` and `optional`
  properties for the new `MockProvider` component.
- **[feat]** Exposed `OperationMock` and `operation` as exports.
- **[feat]** Added a `clear` export to support setting nullable input fields to
  `undefined`.
- **[bugfix]** Implemented universal patch transforms for `variables` and
  `data`.
- **[bugfix]** Updated the generation of `package.json` to support Node.js 16.
- **[bugfix]** Wrapped the CLI in an immediately invoked function, eliminating
  the need for top-level async support.
- **[bugfix]** Improved handling of import statements in GraphQL files.
- **[bugfix]** Fixed an issue where default patches were not applied to deep
  objects.
- **[bugfix]** Enhanced stack capture functionality to include both where the
  mock is built and where the component is rendered.
- **[bugfix]** Improved the resolution of concrete types from interfaces.
- **[bugfix]** Enhanced field aliasing.
- **[bugfix]** Added direct `proxy` support for enums.

# 0.2.4

- **[feat]** `formatCode` is run on code generated from the plugin.
- **[feat]** Imported enums are split to many lines by default.
- **[bugfix]** Changed `formatCode` to not crash if `deno` is missing in MacOS.
- **[bugfix]** Fixed `repository.url` in npm `package.json`.

# 0.2.3

- **[bugfix]** Duplicate operations are skipped.
- **[bugfix]** Fixed array indexes greater than 9.
- **[bugfix]** `namingConvention` is now applied to inputs and is only applied
  when `typesFile` is set.

# 0.2.2

- **[feat]** Added `namingConvention` to CLI, `codegen`, and plugin.

# 0.2.1

- **[bugfix]** Switched to using literals instead of `OperationTypeNode` to
  improve backwards compatibility.

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
