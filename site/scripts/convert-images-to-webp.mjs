import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const imageDirectories = [
  { disk:path.join(projectDir, 'public', 'uploads'), url:'/uploads' },
  { disk:path.join(projectDir, 'public', 'assets', 'heroes'), url:'/assets/heroes' }
];
const jsonFiles = ['content.json', 'events.json', 'heroes.json', 'shows.json', 'plays.json']
  .map(filename => path.join(projectDir, 'data', filename));
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif']);

const walk = async directory => {
  const entries = await fs.readdir(directory, { withFileTypes:true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return nested.flat();
};
const replaceImageUrls = (value, replacements) => {
  if (typeof value === 'string') return replacements.get(value) || value;
  if (Array.isArray(value)) return value.map(item => replaceImageUrls(item, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, replaceImageUrls(item, replacements)]));
  return value;
};
const writeJson = async (file, value) => {
  const temporary = `${file}.webp-${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
};

const replacements = new Map();
const converted = [];
for (const directory of imageDirectories) {
  const files = await walk(directory.disk);
  for (const source of files) {
    const extension = path.extname(source).toLowerCase();
    if (!supportedExtensions.has(extension)) continue;
    const target = `${source.slice(0, -extension.length)}.webp`;
    await sharp(source, { animated:extension === '.gif', limitInputPixels:40_000_000 })
      .rotate()
      .webp({ quality:82, effort:5, smartSubsample:true })
      .toFile(target);
    const relative = path.relative(directory.disk, source).split(path.sep).join('/');
    replacements.set(`${directory.url}/${relative}`, `${directory.url}/${relative.slice(0, -extension.length)}.webp`);
    converted.push({ source, target });
  }
}

for (const file of jsonFiles) {
  const content = JSON.parse(await fs.readFile(file, 'utf8'));
  await writeJson(file, replaceImageUrls(content, replacements));
}
await Promise.all(converted.map(({ source }) => fs.unlink(source)));
console.log(`Converted ${converted.length} images to WebP.`);
