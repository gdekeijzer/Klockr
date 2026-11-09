#!/usr/bin/env node
// Runs `docker compose -f compose.dev.yaml <args>`, falling back to the standalone
// `docker-compose` binary (e.g. Homebrew/Colima setups without the CLI plugin).
import { spawnSync } from 'node:child_process';

const args = ['-f', 'compose.dev.yaml', ...process.argv.slice(2)];
const hasPlugin = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const [cmd, cmdArgs] = hasPlugin ? ['docker', ['compose', ...args]] : ['docker-compose', args];
const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
