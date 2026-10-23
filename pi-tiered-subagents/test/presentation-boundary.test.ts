import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const runtime = fileURLToPath(new URL("..", import.meta.url));
const ui = path.join(runtime, "src", "ui");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(filename)
        : filename.endsWith(".ts")
          ? [filename]
          : [];
    }),
  );
  return files.flat();
}

async function importsIn(directories: string[]) {
  const files = (await Promise.all(directories.map(sourceFiles))).flat();
  return (
    await Promise.all(
      files.map(async (filename) => {
        const source = ts.createSourceFile(
          filename,
          await readFile(filename, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const imports: { file: string; specifier: string }[] = [];
        function visit(node: ts.Node): void {
          // Covers static imports/exports, dynamic imports, and type-only imports.
          if (
            ts.isStringLiteral(node) &&
            (((ts.isImportDeclaration(node.parent) ||
              ts.isExportDeclaration(node.parent)) &&
              node.parent.moduleSpecifier === node) ||
              (ts.isCallExpression(node.parent) &&
                node.parent.expression.kind === ts.SyntaxKind.ImportKeyword) ||
              (ts.isLiteralTypeNode(node.parent) &&
                ts.isImportTypeNode(node.parent.parent)))
          )
            imports.push({ file: filename, specifier: node.text });
          ts.forEachChild(node, visit);
        }
        visit(source);
        return imports;
      }),
    )
  ).flat();
}

function inside(directory: string, filename: string): boolean {
  return filename.startsWith(`${directory}${path.sep}`);
}

describe("terminal presentation module boundary", () => {
  it("keeps TUI implementation inside the UI module", async () => {
    const imports = await importsIn([
      path.join(runtime, "src"),
      path.join(runtime, "extensions"),
    ]);
    expect(
      imports.filter(
        ({ file, specifier }) =>
          !inside(ui, file) &&
          (specifier === "@earendil-works/pi-tui" ||
            specifier.startsWith("@earendil-works/pi-tui/")),
      ),
    ).toEqual([]);
  });

  it("lets UI consume contracts without depending on execution implementation", async () => {
    const imports = await importsIn([ui]);
    expect(
      imports.filter(({ file, specifier }) => {
        if (
          specifier === "@code-fixer-23/pi-tiered-subagents" ||
          specifier.startsWith("@code-fixer-23/pi-tiered-subagents/")
        )
          return true;
        const target = specifier.startsWith("#src/")
          ? path.join(runtime, "src", specifier.slice(5))
          : specifier.startsWith(".")
            ? path.resolve(path.dirname(file), specifier)
            : undefined;
        // A generic optional-field builder carries no runtime policy.
        return (
          target !== undefined &&
          inside(path.join(runtime, "src"), target) &&
          !inside(ui, target) &&
          ![
            path.join(runtime, "src", "optional"),
            path.join(runtime, "src", "optional.js"),
          ].includes(target)
        );
      }),
    ).toEqual([]);
  });
});
