/**
 * seed.ts — Seed script for local development and test environments (Issue #293).
 *
 * Populates:
 *   - Default vaults in `vaults` registry
 *   - Sample user positions in `vault_positions`
 *   - Referral relationships in `referrals`
 *   - Active yield sources in `yield_sources`
 *   - Sample historical yield calculations in `yield_calculations`
 *   - Sample transaction jobs in `transaction_jobs`
 *   - Sample contract events in `vault_events`
 */

import { getWritePool, closePools } from "../db.js";
import { logger } from "../logger.js";

export async function seedDatabase(): Promise<void> {
  const pool = getWritePool();
  const client = await pool.connect();

  logger.info("[seed] Starting development data seeding...");

  try {
    await client.query("BEGIN;");

    // 1. Vaults Registry
    logger.info("[seed] Seeding vaults registry...");
    await client.query(`
      INSERT INTO vaults (id, contract_id, name, underlying_token, network, is_active, is_default, description)
      VALUES 
        (1, 'CAURA_VAULT_TESTNET_XLM', 'Aura XLM Yield Vault', 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'testnet', TRUE, TRUE, 'Primary testnet XLM yield vault'),
        (2, 'CAURA_VAULT_TESTNET_USDC', 'Aura USDC Stable Vault', 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWUGFY2K6T7G2TGYSC', 'testnet', TRUE, FALSE, 'Stellar USDC yield-generating vault')
      ON CONFLICT (contract_id) DO NOTHING;
    `);

    // 2. Sample Vault Positions
    logger.info("[seed] Seeding sample vault positions...");
    await client.query(`
      INSERT INTO vault_positions (user_id, vault_id, amount, entry_date, entry_price, yield_earned)
      VALUES 
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 10000.000000000000000000, NOW() - INTERVAL '30 days', 1.000000000000000000, 152.450000000000000000),
        ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 25000.000000000000000000, NOW() - INTERVAL '15 days', 1.015000000000000000, 189.200000000000000000),
        ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 5000.000000000000000000, NOW() - INTERVAL '5 days', 1.000000000000000000, 12.800000000000000000)
      ON CONFLICT DO NOTHING;
    `);

    // 3. Referrals
    logger.info("[seed] Seeding referrals...");
    await client.query(`
      INSERT INTO referrals (referrer_address, referred_address, registered_at, deposit_volume, pending_reward, claimed_reward)
      VALUES 
        ('GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI', 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', NOW() - INTERVAL '45 days', 5000.00000000, 5.00000000, 0.00000000),
        ('GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI', 'GCNY5OXYSY4FKHOPT2S6QWA2UEKGGFGMTRBOCIBFPWLVISDPW4TGUSGZ', NOW() - INTERVAL '20 days', 15000.00000000, 15.00000000, 0.00000000)
      ON CONFLICT (referred_address) DO NOTHING;
    `);

    // 4. Yield Sources & Calculations
    logger.info("[seed] Seeding yield sources and calculations...");
    await client.query(`
      INSERT INTO yield_sources (id, vault_id, source_type, apy, is_active)
      VALUES 
        (1, '00000000-0000-0000-0000-000000000001', 'staking', 0.06500000, TRUE),
        (2, '00000000-0000-0000-0000-000000000001', 'fees', 0.02100000, TRUE),
        (3, '00000000-0000-0000-0000-000000000002', 'incentives', 0.08200000, TRUE)
      ON CONFLICT DO NOTHING;

      INSERT INTO yield_calculations (position_id, calc_date, daily_yield, total_yield, effective_apy, sources_detail)
      VALUES 
        ('pos-1', NOW() - INTERVAL '1 day', 4.850000000000000000, 152.450000000000000000, 0.08600000, '[{"source":"staking","apy":0.065},{"source":"fees","apy":0.021}]'::jsonb),
        ('pos-2', NOW() - INTERVAL '1 day', 12.100000000000000000, 189.200000000000000000, 0.08600000, '[{"source":"staking","apy":0.065},{"source":"fees","apy":0.021}]'::jsonb)
      ON CONFLICT DO NOTHING;
    `);

    // 5. Transaction Jobs
    logger.info("[seed] Seeding transaction jobs...");
    await client.query(`
      INSERT INTO transaction_jobs (id, tx_type, wallet_address, amount, status, attempts, result)
      VALUES 
        ('job-seed-001', 'deposit', 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI', '1000', 'completed', 1, '{"txHash":"8f3c7e8a9d1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d"}'),
        ('job-seed-002', 'withdrawal', 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', '500', 'waiting', 0, NULL)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 6. Contract Events
    logger.info("[seed] Seeding vault events...");
    await client.query(`
      INSERT INTO vault_events (id, ledger_sequence, ledger_timestamp, event_type, contract_id, caller_address, amount, raw_payload)
      VALUES 
        ('500001:1:0:0', 500001, NOW() - INTERVAL '2 hours', 'deposit', 'CAURA_VAULT_TESTNET_XLM', 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI', 10000000000, '{"shares":"10000000000"}'),
        ('500010:1:0:0', 500010, NOW() - INTERVAL '1 hour', 'harvest', 'CAURA_VAULT_TESTNET_XLM', 'GADMINADDRESSFORHARVESTTESTNET74P7UJVSGZ', 500000000, '{"yield_net":"450000000","fee":"50000000"}')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query("COMMIT;");
    logger.info("[seed] Database seeding completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK;");
    logger.error("[seed] Error seeding database:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    await seedDatabase();
  } catch {
    process.exit(1);
  } finally {
    await closePools().catch(() => {});
  }
}

// Run if executed directly
if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  void main();
}
