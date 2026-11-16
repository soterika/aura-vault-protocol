-- Migration: 010_create_vaults_registry.sql
-- Issue #310: Multi-tenant support for multiple vault contract instances
--
-- Creates the vault registry table that stores metadata for each vault
-- contract instance. All multi-tenant API endpoints scope their data
-- by vault_id. The "default" vault (seeded below) is used when no
-- vaultId parameter is provided for backwards compatibility.

BEGIN;

CREATE TABLE IF NOT EXISTS vaults (
  id               BIGSERIAL    PRIMARY KEY,
  contract_id      TEXT         NOT NULL UNIQUE,          -- Soroban contract address
  name             TEXT         NOT NULL,                 -- Human-readable vault name
  underlying_token TEXT         NOT NULL,                 -- SEP-41 token contract address
  network          TEXT         NOT NULL DEFAULT 'testnet', -- 'testnet' | 'mainnet' | 'futurenet'
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  is_default       BOOLEAN      NOT NULL DEFAULT FALSE,   -- At most one default vault
  description      TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ensure only one default vault exists at a time
CREATE UNIQUE INDEX IF NOT EXISTS vaults_single_default_idx
  ON vaults (is_default)
  WHERE is_default = TRUE;

-- Fast lookup by contract_id
CREATE INDEX IF NOT EXISTS vaults_contract_id_idx
  ON vaults (contract_id);

-- Fast listing of active vaults per network
CREATE INDEX IF NOT EXISTS vaults_network_active_idx
  ON vaults (network, is_active);

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION vaults_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vaults_updated_at_trigger
  BEFORE UPDATE ON vaults
  FOR EACH ROW EXECUTE FUNCTION vaults_set_updated_at();

-- Seed the default vault from environment / known testnet value.
-- In production, replace the contract_id with the deployed contract address.
INSERT INTO vaults (contract_id, name, underlying_token, network, is_active, is_default, description)
VALUES (
  COALESCE(current_setting('app.default_vault_contract_id', TRUE), 'CAURA_VAULT_TESTNET'),
  'Aura Vault (Default)',
  COALESCE(current_setting('app.default_underlying_token', TRUE), 'CAURA_TOKEN_TESTNET'),
  'testnet',
  TRUE,
  TRUE,
  'Default Aura yield vault on Stellar testnet'
)
ON CONFLICT (contract_id) DO NOTHING;

COMMIT;

-- Down Migration
BEGIN;
DROP TRIGGER IF EXISTS vaults_updated_at_trigger ON vaults;
DROP FUNCTION IF EXISTS vaults_set_updated_at();
DROP TABLE IF EXISTS vaults CASCADE;
COMMIT;
