import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getWritePool } from '../db.js';

const KEY_PREFIX = 'avp_';
const HASH_ROUNDS = 12;

export interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  scopes: string[];
  createdAt: string;
}

export async function createApiKey(userId: string, name: string, scopes: string[]): Promise<CreatedApiKey> {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const key = `${KEY_PREFIX}${id}.${secret}`;
  const keyHash = await bcrypt.hash(key, HASH_ROUNDS);
  const { rows } = await getWritePool().query(
    `INSERT INTO api_keys (id, user_id, name, key_hash, scopes)
     VALUES ($1, $2, $3, $4, $5) RETURNING created_at`,
    [id, userId, name, keyHash, scopes],
  );
  return { id, name, key, scopes, createdAt: rows[0].created_at.toISOString() };
}

export async function authenticateApiKey(key: string): Promise<{ userId: string; scopes: string[]; id: string } | null> {
  const match = /^avp_([0-9a-f-]{36})\./i.exec(key);
  if (!match) return null;
  const { rows } = await getWritePool().query(
    'SELECT id, user_id, key_hash, scopes FROM api_keys WHERE id = $1 AND revoked_at IS NULL',
    [match[1]],
  );
  const row = rows[0];
  if (!row || !(await bcrypt.compare(key, row.key_hash))) return null;
  // Usage telemetry is intentionally detached from the request path.
  void getWritePool().query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => undefined);
  return { id: row.id, userId: row.user_id, scopes: row.scopes };
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await getWritePool().query(
    'UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [id, userId],
  );
  return rowCount === 1;
}
