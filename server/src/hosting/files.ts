import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Reject links before creating private directories or opening SQLite. */
export function prepareHostedFiles(files: readonly string[], root = '/data'): void {
  root = resolve(root);
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
    throw new Error('Hosted data root must be a private directory');
  for (const file of files) {
    const local = relative(root, resolve(file));
    if (
      !local ||
      local === '..' ||
      local.startsWith(`..${sep}`) ||
      resolve(root, local) !== resolve(file)
    )
      throw new Error('Hosted files must stay under the data root');
    let directory = root;
    const parts = relative(root, dirname(file)).split(sep).filter(Boolean);
    for (const part of parts) {
      directory = join(directory, part);
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())
        throw new Error('Hosted data directories cannot be links');
    }
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()))
      throw new Error('Hosted private files must be regular files');
  }
}
