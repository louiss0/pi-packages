import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directoryRenames = [
  {
    from: 'tools/pi-generators/src/generators/bundled-package',
    to: 'tools/pi-generators/src/generators/package',
  },
  {
    from: 'tools/pi-generators/src/generators/unbundled-package',
    to: 'tools/pi-generators/src/generators/extension',
  },
];

const fileReplacements = [
  {
    path: 'AGENTS.md',
    replacements: [
      ['pi-generators:bundled-package', 'pi-generators:package'],
      ['pi-generators:unbundled-package', 'pi-generators:extension'],
      ['project:bundled', 'project:package'],
      ['project:unbundled', 'project:extension'],
      ['Unbundled packages', 'Extension packages'],
      ['unbundled packages', 'extension packages'],
    ],
  },
  {
    path: 'README.md',
    replacements: [
      ['bundled dependency layer', 'package dependency layer'],
      ['unbundled Pi extension package', 'Pi extension package'],
      ['project:bundled', 'project:package'],
      ['project:unbundled', 'project:extension'],
      ['bundled packages', 'package-layer projects'],
      ['unbundled packages', 'extension packages'],
      ['Unbundled package', 'Extension package'],
      ['Bundled package', 'Shared package'],
      ['pi-generators:bundled-package', 'pi-generators:package'],
      ['pi-generators:unbundled-package', 'pi-generators:extension'],
      ['run-many -t lint,typecheck,test,metadata', 'affected -t lint,typecheck,test,metadata'],
    ],
  },
  {
    path: 'pi-agent-resource/README.md',
    replacements: [
      ['an unbundled package', 'an extension package'],
      ['bundled workspace packages', 'package-layer workspace projects'],
    ],
  },
  {
    path: 'pi-form-components/README.md',
    replacements: [
      ['Shared bundled package', 'Shared package'],
      ['project:bundled', 'project:package'],
      ['unbundled Pi packages', 'Pi extension packages'],
    ],
  },
  {
    path: 'eslint.config.mjs',
    replacements: [
      ['project:bundled', 'project:package'],
      ['project:unbundled', 'project:extension'],
    ],
  },
  {
    path: 'tools/validate-package-metadata.mjs',
    replacements: [
      ['project:unbundled', 'project:extension'],
    ],
  },
  {
    path: 'tools/pi-generators/generators.json',
    replacements: [
      ['bundled-package', 'package'],
      ['unbundled-package', 'extension'],
      ['bundled Pi package', 'Pi package'],
      ['unbundled Pi package', 'Pi extension package'],
    ],
  },
  {
    path: 'tools/pi-generators/src/generators/shared.cjs',
    replacements: [
      ['bundledTags', 'packageTags'],
      ['unbundledTags', 'extensionTags'],
      ['project:bundled', 'project:package'],
      ['project:unbundled', 'project:extension'],
      ['"bundled"', '"package"'],
      ['"unbundled"', '"extension"'],
    ],
  },
  {
    path: 'tools/pi-generators/src/generators/package/generator.cjs',
    replacements: [
      ['bundledPackageGenerator', 'packageGenerator'],
      ["'bundled'", "'package'"],
    ],
  },
  {
    path: 'tools/pi-generators/src/generators/extension/generator.cjs',
    replacements: [
      ['unbundledPackageGenerator', 'extensionGenerator'],
      ["'unbundled'", "'extension'"],
    ],
  },
  {
    path: 'tools/pi-generators/src/generators/package/schema.json',
    replacements: [
      ['bundled-package', 'package'],
      ['Bundled Pi Package', 'Pi Package'],
      ['generated extension scaffold', 'generated Pi scaffold'],
    ],
  },
  {
    path: 'tools/pi-generators/src/generators/extension/schema.json',
    replacements: [
      ['unbundled-package', 'extension'],
      ['Unbundled Pi Package', 'Pi Extension'],
      ['generated extension scaffold', 'generated Pi scaffold'],
    ],
  },
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function applyReplacements(sourceText, replacements) {
  return replacements.reduce(
    (updatedText, [searchValue, replacementValue]) => updatedText.replaceAll(searchValue, replacementValue),
    sourceText,
  );
}

async function renameLegacyDirectories() {
  for (const renamePlan of directoryRenames) {
    const fromPath = path.join(repositoryRoot, renamePlan.from);
    const toPath = path.join(repositoryRoot, renamePlan.to);

    if (!(await pathExists(fromPath)) || (await pathExists(toPath))) {
      continue;
    }

    await mkdir(path.dirname(toPath), { recursive: true });
    await rename(fromPath, toPath);
  }
}

async function updateFile(filePlan) {
  const filePath = path.join(repositoryRoot, filePlan.path);

  if (!(await pathExists(filePath))) {
    return;
  }

  const sourceText = await readFile(filePath, 'utf8');
  const nextText = applyReplacements(sourceText, filePlan.replacements);

  if (nextText === sourceText) {
    return;
  }

  await writeFile(filePath, nextText);
}

await renameLegacyDirectories();
await Promise.all(fileReplacements.map(updateFile));

console.log('workspace kind rename complete');
