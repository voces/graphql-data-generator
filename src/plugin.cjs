module.exports = {
  async plugin(schema, documents, config) {
    const { codegen } = await import("./codegen.ts");
    return (config.banner ?? "") + codegen(
      schema,
      documents.map((d) => ({ path: d.location, content: d.rawSDL })),
      config,
    );
  },
};
