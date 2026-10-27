import { readFile, writeFile } from "node:fs/promises";
import { generateModelMatrix } from "#src/models/matrix";

const document = new URL("../docs/model-matrix.md", import.meta.url);
let markdown = await readFile(document, "utf8");
for (const region of generateModelMatrix()) {
  const start = `<!-- model-matrix:${region.name}:start -->`;
  const end = `<!-- model-matrix:${region.name}:end -->`;
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end);
  if (
    from === -1 ||
    to < from ||
    markdown.indexOf(start, from + start.length) !== -1 ||
    markdown.indexOf(end, to + end.length) !== -1
  ) {
    throw new Error(`Expected exactly one marker pair for ${region.name}`);
  }
  markdown = `${markdown.slice(0, from)}${start}\n${region.markdown}\n${markdown.slice(to)}`;
}
await writeFile(document, markdown);
console.log(`Regenerated ${document.pathname}`);
