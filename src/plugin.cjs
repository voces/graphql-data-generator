module.exports = {
  async plugin(schema, documents, config) {
    const { codegen } = await import("./codegen.ts");
    const { formatCode } = await import("./util.ts");
    return (config.banner ?? "") + await formatCode(codegen(
      schema,
      documents.map((d) => ({ path: d.location, content: d.rawSDL })),
      { namingConvention: "change-case-all#pascalCase", ...config },
    ));
  },
};
