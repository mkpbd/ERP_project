import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(ROOT, 'src');

interface SourceFile {
  readonly file: string; // posix path relative to src
  readonly imports: string[]; // relative imports resolved to posix paths relative to src; packages as-is
}

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : listTs(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const IMPORT_PATTERN = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const files: SourceFile[] = listTs(SRC).map((full) => {
  const source = readFileSync(full, 'utf8');
  const imports = [...source.matchAll(IMPORT_PATTERN)].map((match) => {
    const specifier = (match[1] ?? match[2])!;
    if (!specifier.startsWith('.')) return specifier;
    return path
      .relative(SRC, path.resolve(path.dirname(full), specifier))
      .split(path.sep)
      .join('/');
  });
  return { file: path.relative(SRC, full).split(path.sep).join('/'), imports };
});

const moduleOf = (target: string) => /^modules\/([^/]+)\//.exec(target)?.[1] ?? null;
const layerOf = (target: string) => /\/(domain|application|infrastructure|presentation)\//.exec(target)?.[1] ?? null;
const isPackage = (target: string) =>
  !target.includes('/') || !/^(modules|shared|database|config|bootstrap|cli)\//.test(target);

function violations(predicate: (file: SourceFile, target: string) => boolean): string[] {
  return files.flatMap((file) =>
    file.imports.filter((target) => predicate(file, target)).map((target) => `${file.file} -> ${target}`),
  );
}

// Foreign keys between module tables are the single sanctioned cross-module
// infrastructure dependency: one database, referential integrity enforced there.
const SANCTIONED_CROSS_MODULE = [/^modules\/[^/]+\/infrastructure\/persistence\/[^/]+\.schema\.ts$/];

describe('architecture boundaries', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('domain depends only on its own module domain and the shared domain kernel', () => {
    const bad = violations((file, target) => {
      if (layerOf(file.file) !== 'domain') return false;
      if (isPackage(target)) return true; // no frameworks or libraries at all
      return !(target.startsWith(`modules/${moduleOf(file.file)}/domain/`) || target.startsWith('shared/domain/'));
    });
    expect(bad).toEqual([]);
  });

  it('application never touches infrastructure, presentation, the database module or persistence packages', () => {
    const forbiddenPackages = /^(drizzle-orm|pg|express|argon2|jose|nodemailer)(\/|$)/;
    const bad = violations((file, target) => {
      if (layerOf(file.file) !== 'application' && !file.file.startsWith('shared/application/')) return false;
      if (isPackage(target)) return forbiddenPackages.test(target);
      return ['infrastructure', 'presentation'].includes(layerOf(target) ?? '') || target.startsWith('database/');
    });
    expect(bad).toEqual([]);
  });

  it('presentation reaches use cases through the buses, never repositories or the database', () => {
    const bad = violations((file, target) => {
      if (layerOf(file.file) !== 'presentation') return false;
      // The request context is populated by the HTTP layer itself, so reading it is allowed.
      if (target === 'shared/infrastructure/request-context.js') return false;
      return layerOf(target) === 'infrastructure' || target.startsWith('database/') || /^drizzle-orm|^pg$/.test(target);
    });
    expect(bad).toEqual([]);
  });

  it('modules do not import each other; they communicate through shared contracts', () => {
    const bad = violations((file, target) => {
      const from = moduleOf(file.file);
      const to = moduleOf(target);
      if (!from || !to || from === to) return false;
      return !SANCTIONED_CROSS_MODULE.some((pattern) => pattern.test(file.file));
    });
    expect(bad).toEqual([]);
  });

  it('the shared kernel does not depend on any business module', () => {
    const bad = violations((file, target) => file.file.startsWith('shared/') && moduleOf(target) !== null);
    expect(bad).toEqual([]);
  });

  it('Drizzle is confined to infrastructure, the database module, and the CLI', () => {
    const bad = violations(
      (file, target) =>
        /^drizzle-orm/.test(target) &&
        layerOf(file.file) !== 'infrastructure' &&
        !file.file.startsWith('database/') &&
        !file.file.startsWith('shared/infrastructure/') &&
        !file.file.startsWith('cli/'),
    );
    expect(bad).toEqual([]);
  });

  it('controllers do not hold business logic dependencies other than the buses', () => {
    const controllers = files.filter(
      (file) => file.file.endsWith('controller.ts') || file.file.endsWith('controllers.ts'),
    );
    expect(controllers.length).toBeGreaterThan(0);
    for (const controller of controllers) {
      const source = readFileSync(path.join(SRC, controller.file), 'utf8');
      const injected = [...source.matchAll(/private readonly \w+: (\w+)/g)].map((match) => match[1]);
      expect(
        injected.every((type) => ['CommandBus', 'QueryBus', 'RefreshCookie'].includes(type!)),
        controller.file,
      ).toBe(true);
    }
  });
});
