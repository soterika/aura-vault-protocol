/**
 * Unit tests for CORS middleware — Issue #297
 *
 * Verifies:
 *  - buildAllowedOrigins() parses CORS_ORIGINS correctly
 *  - Wildcard/empty origins denied in production, allowed in dev
 *  - Listed origins are allowed; unlisted origins are rejected
 *  - Preflight OPTIONS requests return 204 with correct headers
 *  - Credentials header is set for /api/auth/* routes only
 *  - No Origin header is handled correctly per environment
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';
import {
  buildAllowedOrigins,
  createCorsMiddleware,
  corsPreflightHandler,
} from '../../middleware/corsMiddleware.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeApp(): Application {
  const app = express();
  // Express v5 path-to-regexp is strict — use a regex for catch-all OPTIONS
  app.options(/.*/, corsPreflightHandler());
  app.use(createCorsMiddleware());
  app.get('/test', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));
  app.get('/api/v1/vault/stats', (_req, res) => res.json({ ok: true }));
  return app;
}

// ─── buildAllowedOrigins ──────────────────────────────────────────────────────

describe('buildAllowedOrigins()', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
    if (savedEnv.CORS_ORIGIN === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = savedEnv.CORS_ORIGIN;
    }
  });

  it('returns localhost regexes in development when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'development';
    const origins = buildAllowedOrigins();
    expect(origins).toHaveLength(2);
    expect(origins[0]).toBeInstanceOf(RegExp);
    expect(origins[1]).toBeInstanceOf(RegExp);
  });

  it('returns empty array in production when CORS_ORIGINS is unset', () => {
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'production';
    const origins = buildAllowedOrigins();
    expect(origins).toHaveLength(0);
  });

  it('returns empty array in production when CORS_ORIGINS is wildcard (*)', () => {
    process.env.CORS_ORIGINS = '*';
    process.env.NODE_ENV = 'production';
    const origins = buildAllowedOrigins();
    expect(origins).toHaveLength(0);
  });

  it('parses a single origin correctly', () => {
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'production';
    const origins = buildAllowedOrigins();
    expect(origins).toEqual(['https://app.aura-vault.xyz']);
  });

  it('parses multiple comma-separated origins', () => {
    process.env.CORS_ORIGINS =
      'https://app.aura-vault.xyz,https://staging.aura-vault.xyz';
    process.env.NODE_ENV = 'production';
    const origins = buildAllowedOrigins();
    expect(origins).toEqual([
      'https://app.aura-vault.xyz',
      'https://staging.aura-vault.xyz',
    ]);
  });

  it('trims whitespace around origins', () => {
    process.env.CORS_ORIGINS =
      ' https://app.aura-vault.xyz , https://staging.aura-vault.xyz ';
    const origins = buildAllowedOrigins();
    expect(origins).toEqual([
      'https://app.aura-vault.xyz',
      'https://staging.aura-vault.xyz',
    ]);
  });

  it('reads from CORS_ORIGIN as fallback when CORS_ORIGINS is absent', () => {
    delete process.env.CORS_ORIGINS;
    process.env.CORS_ORIGIN = 'https://fallback.aura-vault.xyz';
    process.env.NODE_ENV = 'production';
    const origins = buildAllowedOrigins();
    expect(origins).toEqual(['https://fallback.aura-vault.xyz']);
  });
});

// ─── Allowed origins ──────────────────────────────────────────────────────────

describe('CORS — allowed origins', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
    process.env.CORS_ORIGINS =
      'https://app.aura-vault.xyz,https://staging.aura-vault.xyz';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
  });

  it('allows a listed origin', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.aura-vault.xyz');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.aura-vault.xyz'
    );
  });

  it('rejects an unlisted origin — no ACAO header returned', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://evil.example.com');
    // cors package responds with 500 when origin is rejected via Error callback
    expect([403, 500]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a second listed origin', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://staging.aura-vault.xyz');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://staging.aura-vault.xyz'
    );
  });
});

// ─── Preflight requests ───────────────────────────────────────────────────────

describe('CORS — preflight OPTIONS requests', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
  });

  it('returns 204 for preflight from an allowed origin', async () => {
    const app = makeApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.aura-vault.xyz')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
  });

  it('includes Access-Control-Allow-Methods in preflight response', async () => {
    const app = makeApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.aura-vault.xyz')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/i);
  });

  it('includes Access-Control-Allow-Headers in preflight response', async () => {
    const app = makeApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.aura-vault.xyz')
      .set('Access-Control-Request-Headers', 'Authorization');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  });

  it('includes Access-Control-Max-Age in preflight response', async () => {
    const app = makeApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://app.aura-vault.xyz')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-max-age']).toBe('86400');
  });
});

// ─── Credentials scoping ──────────────────────────────────────────────────────

describe('CORS — credentials allowed only on auth routes', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
  });

  it('sets Access-Control-Allow-Credentials: true on /api/auth/* routes', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://app.aura-vault.xyz');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does NOT set Access-Control-Allow-Credentials on non-auth routes', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/api/v1/vault/stats')
      .set('Origin', 'https://app.aura-vault.xyz');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

// ─── No-Origin header (server-to-server) ─────────────────────────────────────

describe('CORS — requests without Origin header', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
  });

  it('allows no-origin requests in development', async () => {
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'development';
    const app = makeApp();
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  it('allows no-origin requests in test environment', async () => {
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'test';
    const app = makeApp();
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
});

// ─── Exposed headers ─────────────────────────────────────────────────────────

describe('CORS — exposed headers', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
    process.env.CORS_ORIGINS = 'https://app.aura-vault.xyz';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.CORS_ORIGINS === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = savedEnv.CORS_ORIGINS;
    }
  });

  it('exposes X-Correlation-ID to browser clients', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://app.aura-vault.xyz');
    expect(res.headers['access-control-expose-headers']).toMatch(
      /X-Correlation-ID/i
    );
  });
});
