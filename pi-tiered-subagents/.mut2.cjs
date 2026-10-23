const fs = require("node:fs");
const f = "src/lifecycle/subagent-manager.ts";
let src = fs.readFileSync(f, "utf8");
// MUTATION: cancel eagerly on before_switch, ignoring the tentative switch.
src = src.replace(
  "  beginOwnerEnd(): void {\n    if (this.owner) this.ownerEnding = true;\n  }",
  "  beginOwnerEnd(): void {\n    if (this.owner) {\n      this.cancelOwned(this.owner.generation);\n      this.ownerEnding = true;\n    }\n  }",
);
fs.writeFileSync(f, src);
