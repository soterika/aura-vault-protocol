//! On-chain keeper registration and harvest performance statistics.
use soroban_sdk::{Address, Env, Vec};

use crate::{errors::VaultError, storage::{DataKey, KeeperRecord}};

const MAX_REGISTERED_KEEPERS: u32 = 256;
const MAX_LEADERBOARD_LIMIT: u32 = 20;

fn registered(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&DataKey::KeeperList).unwrap_or(Vec::new(env))
}

fn store_record(env: &Env, record: &KeeperRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::KeeperRecord(record.address.clone()), record);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::KeeperRecord(record.address.clone()), 30 * 17_280, 60 * 17_280);
}

pub fn register(env: &Env, address: Address) -> Result<KeeperRecord, VaultError> {
    address.require_auth();
    let key = DataKey::KeeperRecord(address.clone());
    if let Some(record) = env.storage().persistent().get::<_, KeeperRecord>(&key) {
        return Ok(record);
    }

    let mut list = registered(env);
    if !list.iter().any(|existing| existing == address) {
        if list.len() >= MAX_REGISTERED_KEEPERS {
            return Err(VaultError::InvalidAddress);
        }
        list.push_back(address.clone());
        env.storage().instance().set(&DataKey::KeeperList, &list);
    }
    let record = KeeperRecord {
        address: address.clone(),
        harvest_count: 0,
        total_yield_harvested: 0,
        last_harvest_ledger: 0,
        registered_at: env.ledger().timestamp(),
    };
    store_record(env, &record);
    Ok(record)
}

pub fn stats(env: &Env, address: Address) -> Option<KeeperRecord> {
    let key = DataKey::KeeperRecord(address);
    let result = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(&key, 30 * 17_280, 60 * 17_280);
    }
    result
}

pub fn record_harvest(env: &Env, address: &Address, amount: i128) -> Result<(), VaultError> {
    let key = DataKey::KeeperRecord(address.clone());
    let mut record = match env.storage().persistent().get::<_, KeeperRecord>(&key) {
        Some(record) => record,
        None => {
            let mut list = registered(env);
            if !list.iter().any(|existing| existing == *address)
                && list.len() < MAX_REGISTERED_KEEPERS
            {
                list.push_back(address.clone());
                env.storage().instance().set(&DataKey::KeeperList, &list);
            }
            KeeperRecord {
                address: address.clone(),
                harvest_count: 0,
                total_yield_harvested: 0,
                last_harvest_ledger: 0,
                registered_at: env.ledger().timestamp(),
            }
        }
    };
    record.harvest_count = record
        .harvest_count
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;
    record.total_yield_harvested = record
        .total_yield_harvested
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    record.last_harvest_ledger = env.ledger().sequence();
    store_record(env, &record);
    env.events().publish(
        (soroban_sdk::Symbol::new(env, "keeper_harvest_recorded"), address.clone()),
        (record.harvest_count, record.total_yield_harvested, record.last_harvest_ledger),
    );
    Ok(())
}

pub fn top(env: &Env, limit: u32) -> Vec<KeeperRecord> {
    let limit = core::cmp::min(limit, MAX_LEADERBOARD_LIMIT);
    let mut result: Vec<KeeperRecord> = Vec::new(env);
    for address in registered(env).iter() {
        let Some(record) = stats(env, address) else { continue };
        let mut index = 0;
        while index < result.len() {
            if result.get(index).unwrap().total_yield_harvested < record.total_yield_harvested {
                break;
            }
            index += 1;
        }
        if index < limit {
            result.insert(index, record);
            if result.len() > limit {
                result.pop_back();
            }
        }
    }
    result
}
