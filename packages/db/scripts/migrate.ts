import { createDatabase } from '../src/client';
import { runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env or export it.');
  process.exit(1);
}

const handle = createDatabase(url);
try {
  await runMigrations(handle);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
