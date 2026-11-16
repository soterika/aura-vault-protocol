import { db } from "../db.js";
import type { PaginatedResponse } from "../types/pagination.js";
import { paginatedResponse } from "../types/pagination.js";

export interface ContractEvent {
  id: string;
  ledger_sequence: string;
  transaction_hash: string;
  event_index: string;
  contract_id: string;
  event_type: string;
  topic: unknown;
  value: unknown;
  created_at: Date;
}

export interface EventSearchOptions {
  q: string;
  type?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function searchEvents(
  options: EventSearchOptions
): Promise<PaginatedResponse<ContractEvent>> {
  const conditions = ["search_vector @@ websearch_to_tsquery('simple', $1)"];
  const values: unknown[] = [options.q];
  const addFilter = (sql: string, value: unknown) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };

  if (options.type) addFilter("event_type = ?", options.type);
  if (options.from) addFilter("created_at >= ?::timestamptz", options.from);
  if (options.to) addFilter("created_at <= ?::timestamptz", options.to);

  const where = conditions.join(" AND ");
  const countResult = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM contract_events WHERE ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const limitPosition = values.length + 1;
  const offsetPosition = values.length + 2;
  const result = await db.query<ContractEvent>(
    `SELECT id, ledger_sequence, transaction_hash, event_index, contract_id,
            event_type, topic, value, created_at
       FROM contract_events
      WHERE ${where}
      ORDER BY created_at DESC, ledger_sequence DESC, event_index DESC
      LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    [...values, options.pageSize, (options.page - 1) * options.pageSize]
  );

  return paginatedResponse(result.rows, options.page, options.pageSize, total);
}
