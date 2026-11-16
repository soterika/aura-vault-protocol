import { isIP } from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import { auditRepository } from '../modules/audit/audit.repository.js';
import { logger } from '../logger.js';

type IpValue = { bits: number; value: bigint };

function parseIp(raw: string): IpValue | null {
  let input = raw.trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (input.startsWith('::ffff:') && isIP(input.slice(7)) === 4) input = input.slice(7);
  const version = isIP(input);
  if (version === 4) {
    const parts = input.split('.').map(Number);
    return { bits: 32, value: parts.reduce((n, part) => (n << 8n) | BigInt(part), 0n) };
  }
  if (version !== 6) return null;
  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (groups.length !== 8) return null;
  return { bits: 128, value: groups.reduce((n, group) => (n << 16n) | BigInt(`0x${group || '0'}`), 0n) };
}

export function matchesCidr(ip: string, cidr: string): boolean {
  const [networkText, prefixText] = cidr.trim().split('/');
  const address = parseIp(ip);
  const network = parseIp(networkText);
  if (!address || !network || address.bits !== network.bits) return false;
  const prefix = prefixText === undefined ? address.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return false;
  const shift = BigInt(address.bits - prefix);
  return (address.value >> shift) === (network.value >> shift);
}

function requestClientIp(req: Request): string {
  if (process.env.TRUST_PROXY !== 'true') return (req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
  const forwarded = req.headers['x-forwarded-for'];
  const candidates = typeof forwarded === 'string' ? forwarded.split(',') : [];
  // ALB appends the connecting client address at the right edge of X-Forwarded-For.
  const forwardedIp = candidates.at(-1)?.trim();
  return forwardedIp && parseIp(forwardedIp) ? forwardedIp.replace(/^::ffff:/i, '') : (req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
}

const allowedCidrs = (process.env.ADMIN_IP_ALLOWLIST ?? '').split(',').map((value) => value.trim()).filter(Boolean);
if (allowedCidrs.length === 0) logger.warn('[admin-ip] ADMIN_IP_ALLOWLIST is unset; admin endpoints allow any source IP after admin authentication');

export async function adminIpAllowlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as Request & { user?: { sub?: string } }).user;
  const clientIp = requestClientIp(req);
  const allowed = allowedCidrs.length === 0 || allowedCidrs.some((cidr) => matchesCidr(clientIp, cidr));
  try {
    await auditRepository.create({
      actor: user?.sub ?? 'unknown',
      entityType: 'admin_ip_allowlist',
      entityId: clientIp || 'unknown',
      action: allowed ? 'ADMIN_IP_ALLOWLIST_ALLOWED' : 'ADMIN_IP_ALLOWLIST_DENIED',
      metadata: { path: req.originalUrl, method: req.method, allowed },
    });
  } catch (error) {
    logger.error({ error, allowed }, '[admin-ip] unable to persist allowlist audit record');
  }
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
