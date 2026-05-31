import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const extensionPath = process.argv[2];

if (!extensionPath) {
  throw new Error("Provide an extension path. Example: pnpm create:extension auth/index.ts");
}

const file = join("extensions", extensionPath);

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, "\n  import { type ExtensionAPI  } from \"@earendil-works/pi-coding-agent\";\n  export default function (pi:ExtensionAPI) {\n\n      }");
