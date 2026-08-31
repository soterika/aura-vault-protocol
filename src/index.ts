import dotenv from 'dotenv';
import { HorizonListener } from './listeners/horizonListener';

dotenv.config();

const CONTRACT_ID = process.env.CONTRACT_ID || '';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

if (!CONTRACT_ID) {
    console.error('❌ CONTRACT_ID environment variable is required');
    process.exit(1);
}

console.log('🌟 Aura Vault Protocol - Horizon Event Listener');
console.log(`📋 Contract ID: ${CONTRACT_ID}`);
console.log(`🌐 Horizon URL: ${HORIZON_URL}`);

const listener = new HorizonListener(CONTRACT_ID, HORIZON_URL);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    await listener.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    await listener.stop();
    process.exit(0);
});

// Start the listener
listener.start().catch((error) => {
    console.error('❌ Failed to start listener:', error);
    process.exit(1);
});

// Export for testing
export { HorizonListener, EventParser, EventRepository };
