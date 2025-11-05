// import json from "@rollup/plugin-json";

export default {
  input: "src/plugin/index.mjs",
  output: {
    file: "plugin/index.cjs",
    format: "cjs",
    // esModule: false
  },
  // plugins: [json()],
  // external: ["node:fs"],
};
