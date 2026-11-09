import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('server configuration', () => {
  it('local defaults: loopback, port 4000, no Secure cookies, no auto-migrate', () => {
    expect(loadConfig({})).toMatchObject({
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: 4000,
      COOKIE_SECURE: false,
      MIGRATE_ON_START: false,
    });
  });

  it('container ACC configuration', () => {
    const config = loadConfig({
      SERVER_HOST: '0.0.0.0',
      SERVER_PORT: '4000',
      DATABASE_URL: 'postgres://klockr:secret@db:5432/klockr',
      KLOCKR_PUBLIC_URL: 'https://acc.klockr.live',
      COOKIE_SECURE: 'true',
      MIGRATE_ON_START: 'false',
    });
    expect(config).toMatchObject({
      SERVER_HOST: '0.0.0.0',
      KLOCKR_PUBLIC_URL: 'https://acc.klockr.live',
      COOKIE_SECURE: true,
      MIGRATE_ON_START: false,
    });
  });

  it('rejects a malformed public URL at startup', () => {
    expect(() => loadConfig({ KLOCKR_PUBLIC_URL: 'acc.klockr.live' })).toThrow();
  });
});
