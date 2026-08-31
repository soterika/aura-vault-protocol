import { query, transaction, getClient } from '../db';
import { VaultEvent, EventCursor } from '../types/events';

export class EventRepository {
    static async saveEvent(event: VaultEvent): Promise<void> {
        const sql = `
            INSERT INTO vault_events (
                event_id, contract_id, event_type, tx_hash,
                ledger, occurred_at, data, parsed_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (event_id) DO UPDATE SET
                processed = FALSE,
                processed_at = NULL,
                updated_at = CURRENT_TIMESTAMP
        `;

        await query(sql, [
            event.id,
            event.contract_id,
            event.type,
            event.tx_hash,
            event.ledger,
            event.occurred_at,
            event.data,
            event.parsed_data || null,
        ]);
    }

    static async markProcessed(eventId: string): Promise<void> {
        const sql = `
            UPDATE vault_events
            SET processed = TRUE, processed_at = CURRENT_TIMESTAMP
            WHERE event_id = $1
        `;
        await query(sql, [eventId]);
    }

    static async saveDeadLetter(
        eventId: string,
        contractId: string,
        rawEvent: any,
        error: Error
    ): Promise<void> {
        const sql = `
            INSERT INTO dead_letter_events (
                event_id, contract_id, raw_event, error_message, error_stack
            ) VALUES ($1, $2, $3, $4, $5)
        `;
        await query(sql, [
            eventId,
            contractId,
            rawEvent,
            error.message,
            error.stack,
        ]);
    }

    static async updateCursor(
        contractId: string,
        lastEventId: string,
        lastLedger: number
    ): Promise<void> {
        const sql = `
            UPDATE event_cursor
            SET last_event_id = $1,
                last_ledger = $2,
                last_processed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE contract_id = $3
        `;
        await query(sql, [lastEventId, lastLedger, contractId]);
    }

    static async getCursor(contractId: string): Promise<EventCursor | null> {
        const sql = `
            SELECT contract_id, last_event_id, last_ledger, last_processed_at
            FROM event_cursor
            WHERE contract_id = $1
        `;
        const rows = await query(sql, [contractId]);
        return rows.length > 0 ? rows[0] : null;
    }

    static async backfillEvents(
        contractId: string,
        fromLedger: number
    ): Promise<any[]> {
        const sql = `
            SELECT * FROM vault_events
            WHERE contract_id = $1 AND ledger >= $2
            ORDER BY ledger ASC
        `;
        return query(sql, [contractId, fromLedger]);
    }

    static async getUnprocessedEvents(limit: number = 100): Promise<VaultEvent[]> {
        const sql = `
            SELECT * FROM vault_events
            WHERE processed = FALSE
            ORDER BY occurred_at ASC
            LIMIT $1
        `;
        return query(sql, [limit]);
    }
}
