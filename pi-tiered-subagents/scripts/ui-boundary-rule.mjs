import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const project = fileURLToPath(new URL("..", import.meta.url));
const ui = path.join(project, "src", "ui");
const optional = path.join(project, "src", "optional.ts");
const packageName = "@code-fixer-23/pi-tiered-subagents";



export const uiBoundaryRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep presentation independent of execution implementation.",
    },
    schema: [],
    messages: {
      dependency:
        'The UI module consumes UI-owned views/actions; "{{specifier}}" must not import implementation outside presentation.',
    },
  },
  create(context) {
    const configFile = path.join(project, "tsconfig.json");
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error)
      throw new Error(
        ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
      );
    const { options } = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      project,
      undefined,
      configFile,
    );
    const filename = context.filename;

    function resolveTarget(specifier) {
      const resolved = ts.resolveModuleName(
        specifier,
        filename,
        options,
        ts.sys,
      );
      if (!resolved.resolvedModule) return null;
      return resolved.resolvedModule.resolvedFileName;
    }

    function isUIFile(file) {
      try {
        const relative = path.relative(ui, file);
        return (
          relative === "" ||
          (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
        );
      } catch {
        return false;
      }
    }

    function specifierOf(node, parentType) {
      if (!node) return null;
      if (parentType === "TSImportType") {
        const arg = node.argument;
        if (arg && arg.type === "Literal" && typeof arg.value === "string") {
          return arg.value;
        }
        const qualifier = node.qualifier;
        if (qualifier && typeof qualifier.value === "string") {
          return qualifier.value;
        }
        return null;
      }
      if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
      }
      if (node.value) return node.value;
      return null;
    }

    function checkSpec(specifier, node, parentType) {
      if (typeof specifier !== "string" || !specifier) return;
      const self =
        specifier === packageName || specifier.startsWith(`${packageName}/`);
      const local =
        self ||
        specifier.startsWith(".") ||
        specifier.startsWith("#") ||
        path.isAbsolute(specifier);
      const target = local ? resolveTarget(specifier) : null;
      const sharedUtility =
        typeof target === "string" &&
        path.normalize(target) === path.normalize(optional);
      const insideUI = typeof target === "string" && isUIFile(target);
      if (local && typeof target === "string" && !insideUI && !sharedUtility) {
        context.report({ node, messageId: "dependency", data: { specifier } });
        return;
      }
      const isLiteralString =
        node && node.type === "Literal" && typeof node.value === "string";
      if (
        (parentType === "ImportExpression" || parentType === "TSImportType") &&
        !isLiteralString
      ) {
        context.report({ node, messageId: "dependency", data: { specifier } });
      }
    }

    return {
      ImportDeclaration: (node) =>
        checkSpec(
          specifierOf(node.source, "ImportDeclaration"),
          node.source,
          "ImportDeclaration",
        ),
      ExportNamedDeclaration: (node) =>
        node.source
          ? checkSpec(
              specifierOf(node.source, "ExportNamedDeclaration"),
              node.source,
              "ExportNamedDeclaration",
            )
          : undefined,
      ExportAllDeclaration: (node) =>
        checkSpec(
          specifierOf(node.source, "ExportAllDeclaration"),
          node.source,
          "ExportAllDeclaration",
        ),
      ImportExpression: (node) =>
        checkSpec(
          specifierOf(node.source, "ImportExpression"),
          node,
          "ImportExpression",
        ),
      TSImportType: (node) =>
        checkSpec(specifierOf(node, "TSImportType"), node, "TSImportType"),
    };
  },
};
