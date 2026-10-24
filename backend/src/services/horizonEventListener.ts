/** Index governance lifecycle events emitted by the Aura Vault Soroban contract. */
import { getWritePool } from "../db.js";

export type GovernanceEventName =
  | "proposal_created"
  | "vote_cast"
  | "timelock_started"
  | "proposal_executed"
  | "proposal_expired";

export interface HorizonEventEnvelope {
  contractId: string;
  /** Decoded Soroban topics, with the event name in the first position. */
  topics: unknown[];
  /** Decoded Soroban event value. */
  value: unknown;
  ledgerTimestamp?: number;
}

export interface ParsedGovernanceEvent {
  name: GovernanceEventName;
  contractId: string;
  proposalId: string;
  proposer?: string;
  voter?: string;
  voteCount?: number;
  expiresAt?: number;
  ledgerTimestamp?: number;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function tuple(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Normalize the lifecycle event topics and data emitted by governance.rs. */
export function parseGovernanceEvent(event: HorizonEventEnvelope): ParsedGovernanceEvent | null {
  const name = scalar(event.topics[0]) as GovernanceEventName | undefined;
  const supported: GovernanceEventName[] = [
    "proposal_created", "vote_cast", "timelock_started", "proposal_executed", "proposal_expired",
  ];
  if (!name || !supported.includes(name)) return null;

  const proposalId = scalar(event.topics[1]);
  if (!proposalId || !/^\d+$/.test(proposalId)) return null;
  const data = tuple(event.value);
  const parsed: ParsedGovernanceEvent = {
    name,
    contractId: event.contractId,
    proposalId,
    ledgerTimestamp: event.ledgerTimestamp,
  };
  if (name === "proposal_created") {
    parsed.proposer = scalar(data[0]);
    const expires = scalar(data[1]);
    if (expires && /^\d+$/.test(expires)) parsed.expiresAt = Number(expires);
  }
  if (name === "vote_cast") {
    parsed.voter = scalar(data[0]);
    const count = scalar(data[1]);
    if (count && /^\d+$/.test(count)) parsed.voteCount = Number(count);
  }
  return parsed;
}

/** Persist one decoded event; repeated Horizon deliveries are idempotent. */
export async function handleHorizonGovernanceEvent(
  event: HorizonEventEnvelope,
): Promise<boolean> {
  const parsed = parseGovernanceEvent(event);
  if (!parsed) return false;

  const pool = getWritePool();
  const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt * 1000) : null;
  if (parsed.name === "proposal_created") {
    await pool.query(
      `INSERT INTO governance_proposals (contract_id, proposal_id, proposer, status, expires_at)
       VALUES ($1, $2, $3, 'created', $4)
       ON CONFLICT (contract_id, proposal_id) DO UPDATE SET
         proposer = COALESCE(EXCLUDED.proposer, governance_proposals.proposer),
         expires_at = COALESCE(EXCLUDED.expires_at, governance_proposals.expires_at),
         updated_at = NOW()`,
      [parsed.contractId, parsed.proposalId, parsed.proposer ?? null, expiresAt],
    );
    return true;
  }

  if (parsed.name === "vote_cast") {
    await pool.query(
      `UPDATE governance_proposals SET status = 'voting', updated_at = NOW()
       WHERE contract_id = $1 AND proposal_id = $2 AND status = 'created'`,
      [parsed.contractId, parsed.proposalId],
    );
    if (parsed.voter) {
      await pool.query(
        `INSERT INTO governance_proposal_votes (contract_id, proposal_id, voter, vote_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contract_id, proposal_id, voter) DO UPDATE SET vote_count = EXCLUDED.vote_count`,
        [parsed.contractId, parsed.proposalId, parsed.voter, parsed.voteCount ?? null],
      );
    }
    return true;
  }

  const transition = parsed.name === "timelock_started"
    ? "timelock"
    : parsed.name === "proposal_executed"
      ? "executed"
      : "expired";
  await pool.query(
    `UPDATE governance_proposals SET status = $3, updated_at = NOW(),
       executed_at = CASE WHEN $3 = 'executed' THEN COALESCE($4, NOW()) ELSE executed_at END,
       expired_at = CASE WHEN $3 = 'expired' THEN COALESCE($4, NOW()) ELSE expired_at END
     WHERE contract_id = $1 AND proposal_id = $2`,
    [parsed.contractId, parsed.proposalId, transition,
      parsed.ledgerTimestamp ? new Date(parsed.ledgerTimestamp * 1000) : null],
  );
  return true;
}
