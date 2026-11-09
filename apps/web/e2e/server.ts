import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../server/dist/main.js', import.meta.url));
const port = 4000;

/** Starts the built API server (the process the web app's rewrites point at). */
export class ApiServer {
  #child: ChildProcess | null = null;

  async start(): Promise<void> {
    if (await this.healthy())
      throw new Error(`Port ${String(port)} is busy: stop the dev server before running E2E`);
    this.#child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        SERVER_HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        MIGRATE_ON_START: 'true',
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgres://klockr:klockr@localhost:54329/klockr_dev',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    for (let i = 0; i < 100; i++) {
      if (await this.healthy()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('API server did not become healthy');
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    this.#child = null;
  }

  private async healthy(): Promise<boolean> {
    try {
      return (await fetch(`http://127.0.0.1:${String(port)}/health`)).ok;
    } catch {
      return false;
    }
  }
}
