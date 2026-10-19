// Restores a backup into one bot instance (README "Backups and restore"):
//   npm run restore -- <env file> <backup.json> [--clear]
// The env file names the target explicitly (TGCLOUD_TOKEN, ADMIN_ID; see .env.example),
// so the restore never lands in whatever bot `tgcloud login` linked. The never-deployed
// endpoints in scripts/tgcloud/endpoints/ are copied into tgcloud/endpoints/ only for the
// `tgcloud run` (which runs local code in the cloud without deploying it) and always
// deleted afterwards, and tgcloud/lib/config.js is generated for the target and then
// put back as it was. `tgcloud run` echoes its argument, the whole backup, so that line
// is left out of the output.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv, stripVTControlCharacters } from 'node:util';
import { CONFIG_PATH, renderConfig } from './gen-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The never-deployed endpoints, by name. */
export const OPERATOR_ENDPOINTS = ['clear_library', 'restore'];

/** @param {string} name */
const sourceOf = (name) => `${root}scripts/tgcloud/endpoints/${name}.js`;
/** @param {string} name */
export const copyOf = (name) => `${root}tgcloud/endpoints/${name}.js`;

/** The confirmation clear_library needs (scripts/tgcloud/endpoints/clear_library.js). */
const CLEAR_CONFIRMATION = 'delete memes and users';

/**
 * The `tgcloud run` calls for a restore, each as the admin.
 * @param {{ backupJson: string, adminId: number, clear: boolean }} options
 * @returns {string[][]} argument lists for `tgcloud`
 */
export function runCommands({ backupJson, adminId, clear }) {
  const ctx = JSON.stringify({ initData: { user: { id: adminId } } });
  const commands = [['run', 'endpoints/restore', backupJson, '--ctx', ctx]];
  if (clear) {
    const confirm = JSON.stringify({ confirm: CLEAR_CONFIRMATION });
    commands.unshift(['run', 'endpoints/clear_library', confirm, '--ctx', ctx]);
  }
  return commands;
}

/**
 * `tgcloud run` output without the echoed call: its `> name(args)` line holds the
 * whole backup.
 * @param {string} output
 */
export function withoutEcho(output) {
  return output
    .split('\n')
    .filter((line) => !stripVTControlCharacters(line).startsWith('> '))
    .join('\n');
}

/**
 * The tgcloud app id in a token `app<id>:<secret>`, which names the target bot.
 * @param {string | undefined} token
 */
export function appIdOf(token) {
  const match = /^app(\d+):./.exec(token ?? '');
  if (!match) throw new Error('TGCLOUD_TOKEN must be set in the env file, as app<id>:<secret>');
  return match[1];
}

/**
 * @param {string} envFile
 * @param {string} backupFile
 * @param {boolean} clear
 */
async function main(envFile, backupFile, clear) {
  // Only the file's keys: a TGCLOUD_TOKEN or ADMIN_ID exported in the shell must not
  // redirect the restore to another bot.
  const env = parseEnv(readFileSync(envFile, 'utf8'));
  const appId = appIdOf(env.TGCLOUD_TOKEN);
  const config = renderConfig(env);
  const adminId = Number(env.ADMIN_ID);

  const backupJson = readFileSync(backupFile, 'utf8');
  const backup = JSON.parse(backupJson);
  const memes = Array.isArray(backup?.memes) ? backup.memes.length : '?';
  const users = Array.isArray(backup?.users) ? backup.users.length : '?';

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `${clear ? 'Delete every meme and user of' : 'Restore into'} tgcloud app ${appId} ` +
      `(admin ${adminId})${clear ? ', then restore' : ''} ${memes} memes and ${users} users ` +
      `from ${backupFile}.\nType the app id to continue: `,
  );
  rl.close();
  if (answer.trim() !== appId) throw new Error('Not confirmed; nothing was changed.');

  const savedConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf8') : null;
  const cleanUp = () => {
    for (const name of OPERATOR_ENDPOINTS) rmSync(copyOf(name), { force: true });
    if (savedConfig === null) rmSync(CONFIG_PATH, { force: true });
    else writeFileSync(CONFIG_PATH, savedConfig);
  };
  process.once('SIGINT', () => {
    cleanUp();
    process.exit(130);
  });
  try {
    // The CLI works in the nearest ancestor holding .tgcloud/; without one here (a fresh
    // clone, a git worktree) it would run another checkout's modules, or find no copy.
    mkdirSync(`${root}.tgcloud`, { recursive: true });
    writeFileSync(CONFIG_PATH, config);
    for (const name of OPERATOR_ENDPOINTS) copyFileSync(sourceOf(name), copyOf(name));
    for (const args of runCommands({ backupJson, adminId, clear })) {
      const run = spawnSync('npx', ['tgcloud', ...args], {
        cwd: root,
        env: { ...process.env, TGCLOUD_TOKEN: env.TGCLOUD_TOKEN },
        stdio: ['inherit', 'pipe', 'inherit'],
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      stdout.write(withoutEcho(run.stdout ?? ''));
      if (run.status !== 0) throw new Error(`tgcloud ${args[1]} failed; see above.`);
    }
  } finally {
    cleanUp();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { clear: { type: 'boolean', default: false } },
  });
  if (positionals.length !== 2) {
    console.error('Usage: npm run restore -- <env file> <backup.json> [--clear]');
    process.exit(2);
  }
  main(positionals[0], positionals[1], values.clear).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
