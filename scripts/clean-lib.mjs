import {readdirSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Only generated files in this repository's fixed lib directory; no recursive deletion.
const directory = new URL('../lib/', import.meta.url);
for (const entry of readdirSync(directory, {withFileTypes: true})) {
  if (entry.isFile() && /\.js(?:\.map)?$/.test(entry.name)) rmSync(fileURLToPath(new URL(entry.name, directory)));
}
