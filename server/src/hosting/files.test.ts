import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareHostedFiles } from './files.js';

test('hosted file preparation creates private subdirectories and rejects escapes before opening files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-hosted-files-'));
  const root = join(directory, 'data');
  mkdirSync(root);
  try {
    prepareHostedFiles([join(root, 'private', 'tokens.json')], root);
    expect(existsSync(join(root, 'private'))).toBe(true);
    expect(() => prepareHostedFiles([join(directory, 'outside.sqlite')], root)).toThrow();
    expect(existsSync(join(directory, 'outside.sqlite'))).toBe(false);
    const target = join(directory, 'external');
    mkdirSync(target);
    symlinkSync(target, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => prepareHostedFiles([join(root, 'link', 'tokens.json')], root)).toThrow();
    expect(existsSync(join(target, 'tokens.json'))).toBe(false);
    const wrong = join(root, 'directory.sqlite');
    mkdirSync(wrong);
    expect(() => prepareHostedFiles([wrong], root)).toThrow();
    writeFileSync(join(root, 'existing.json'), '{}');
    expect(() => prepareHostedFiles([join(root, 'existing.json')], root)).not.toThrow();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
