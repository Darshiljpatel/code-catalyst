/** Execute real suites. Never fabricate pass records or promote release evidence. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.PYTHON || path.join(root, '.venv/bin/python');
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must name the dedicated migrated brandguard_s1_test database.');
if (!fs.existsSync(process.env.BROWSER_FIXTURE_PATH || '/tmp/brandguard-browser-fixture.json')) throw new Error('Provision the isolated browser tenant first; see tests/e2e/README.md.');
for (const [program, args, cwd] of [
  [python, ['-m', 'pytest', 'apps/api/tests', 'tests', '-q'], root],
  ['npm', ['run', 'build'], path.join(root, 'apps/web')],
  ['npm', ['run', 'lint'], path.join(root, 'apps/web')],
  ['npx', ['playwright', 'test'], path.join(root, 'apps/web')],
]) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Executed suites passed. Deployment, retention and human evaluation require separate evidence.');
