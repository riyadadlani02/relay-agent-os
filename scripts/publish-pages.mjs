import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
execFileSync('npm', ['run', 'build:pages'], { cwd: root, stdio: 'inherit' });
const remote = git(['remote', 'get-url', 'origin']);
const author = git(['config', 'user.name']);
const email = git(['config', 'user.email']);
const lookup = spawnSync('git', ['ls-remote', '--exit-code', '--heads', remote, 'gh-pages'], {
  encoding: 'utf8',
});
if (lookup.status !== 0 && lookup.status !== 2)
  throw new Error('Could not check the deployment branch. Verify your Git authentication.');
const directory = mkdtempSync(join(tmpdir(), 'relay-pages-'));
try {
  if (lookup.status === 0)
    git(['clone', '--quiet', '--single-branch', '--branch', 'gh-pages', remote, directory]);
  else {
    git(['init', '--quiet', '-b', 'gh-pages', directory]);
    git(['remote', 'add', 'origin', remote], directory);
  }
  for (const entry of readdirSync(directory))
    if (entry !== '.git') rmSync(join(directory, entry), { recursive: true, force: true });
  cpSync(join(root, 'dist-pages'), directory, { recursive: true });
  writeFileSync(join(directory, '.nojekyll'), '');
  cpSync(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  git(['config', 'user.name', author], directory);
  git(['config', 'user.email', email], directory);
  git(['add', '--all'], directory);
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: directory });
  if (changed.status === 0) console.log('GitHub Pages already has this build.');
  else {
    git(['commit', '--quiet', '-m', 'Publish Relay OS website'], directory);
    execFileSync('git', ['push', '-u', 'origin', 'gh-pages'], { cwd: directory, stdio: 'inherit' });
  }
} finally {
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
