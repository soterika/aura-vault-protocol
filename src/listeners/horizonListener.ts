import EventSource from 'eventsource';
import { EventParser } from '../parsers';
import { EventRepository } from '../repositories/eventRepository';
import { VaultEvent } from '../types/events';

interface HorizonEvent {
    id: string;
    type: string;
    contract_id: string;
    tx_hash: string;
    ledger: number;
    occurred_at: string;
    data: any;
}

export class HorizonListener {
    private eventSource: EventSource | null = null;
    private contractId: string;
    private horizonUrl: string;
    private reconnectDelay: number = 1000;
    private maxReconnectDelay: number = 30000;
    private isConnected: boolean = false;
    private isReconnecting: boolean = false;
    private lastEventId: string | null = null;
    private lastLedger: number | null = null;

    constructor(contractId: string, horizonUrl: string = 'https://horizon.stellar.org') {
        this.contractId = contractId;
        this.horizonUrl = horizonUrl;
    }

    async start(): Promise<void> {
        console.log(`🚀 Starting Horizon listener for contract ${this.contractId}`);

        // Load cursor from database
        const cursor = await EventRepository.getCursor(this.contractId);
        if (cursor) {
            this.lastEventId = cursor.last_event_id;
            this.lastLedger = cursor.last_ledger;
            console.log(`📌 Resuming from event: ${this.lastEventId || 'start'}`);
        }

        // Backfill missed events
        if (this.lastLedger) {
            await this.backfillEvents();
        }

        // Start SSE connection
        this.connect();
    }

    private connect(): void {
        const url = `${this.horizonUrl}/contracts/${this.contractId}/events`;
        const options: any = {};

        if (this.lastEventId) {
            options.headers = {
                'Last-Event-ID': this.lastEventId,
            };
        }

        console.log(`🔗 Connecting to ${url}`);
        this.eventSource = new EventSource(url, options);

        this.eventSource.onopen = () => {
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectDelay = 1000;
            console.log('✅ SSE connection established');
        };

        this.eventSource.onmessage = (event) => {
            this.handleEvent(event);
        };

        this.eventSource.onerror = (error) => {
            console.error('❌ SSE connection error:', error);
            this.isConnected = false;
            this.handleDisconnect();
        };

        // Add event listener for specific event types
        this.eventSource.addEventListener('deposit', (event) => {
            this.handleEvent(event);
        });

        this.eventSource.addEventListener('withdraw', (event) => {
            this.handleEvent(event);
        });

        this.eventSource.addEventListener('harvest', (event) => {
            this.handleEvent(event);
        });

        this.eventSource.addEventListener('pause', (event) => {
            this.handleEvent(event);
        });

        this.eventSource.addEventListener('suspicious', (event) => {
            this.handleEvent(event);
        });
    }

    private async handleEvent(event: MessageEvent): Promise<void> {
        try {
            const rawEvent: HorizonEvent = JSON.parse(event.data);

            // Parse the event data
            const parsedData = EventParser.parseEvent(rawEvent.type, rawEvent.data);

            // Create vault event
            const vaultEvent: VaultEvent = {
                id: rawEvent.id,
                type: rawEvent.type as any,
                contract_id: rawEvent.contract_id,
                tx_hash: rawEvent.tx_hash,
                ledger: rawEvent.ledger,
                occurred_at: new Date(rawEvent.occurred_at),
                data: rawEvent.data,
                parsed_data: parsedData,
            };

            // Save to database
            await EventRepository.saveEvent(vaultEvent);

            // Update cursor
            this.lastEventId = rawEvent.id;
            this.lastLedger = rawEvent.ledger;
            await EventRepository.updateCursor(
                this.contractId,
                rawEvent.id,
                rawEvent.ledger
            );

            console.log(`✅ Processed ${rawEvent.type} event: ${rawEvent.id}`);
        } catch (error) {
            console.error('❌ Failed to process event:', error);
            await this.handleFailedEvent(event, error);
        }
    }

    private async handleFailedEvent(event: MessageEvent, error: Error): Promise<void> {
        try {
            const rawEvent = JSON.parse(event.data);
            await EventRepository.saveDeadLetter(
                rawEvent.id,
                rawEvent.contract_id,
                rawEvent,
                error
            );
        } catch (deadLetterError) {
            console.error('❌ Failed to save dead letter:', deadLetterError);
        }
    }

    private handleDisconnect(): void {
        if (this.isReconnecting) return;

        this.isReconnecting = true;
        console.log(`🔄 Reconnecting in ${this.reconnectDelay}ms...`);

        setTimeout(() => {
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
            this.connect();
        }, this.reconnectDelay);
    }

    private async backfillEvents(): Promise<void> {
        console.log('📥 Backfilling missed events...');

        try {
            const events = await EventRepository.backfillEvents(
                this.contractId,
                this.lastLedger || 0
            );

            if (events.length > 0) {
                console.log(`📥 Backfilled ${events.length} events`);
            }
        } catch (error) {
            console.error('❌ Backfill failed:', error);
        }
    }

    async stop(): Promise<void> {
        console.log('🛑 Stopping Horizon listener...');
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.isConnected = false;
        console.log('✅ Horizon listener stopped');
    }

    getStatus(): {
        connected: boolean;
        contractId: string;
        lastEventId: string | null;
        lastLedger: number | null;
    } {
        return {
            connected: this.isConnected,
            contractId: this.contractId,
            lastEventId: this.lastEventId,
            lastLedger: this.lastLedger,
        };
    }
}
