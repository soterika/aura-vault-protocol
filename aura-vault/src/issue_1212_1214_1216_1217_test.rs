#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, ProposalViewStatus, VaultError};

fn setup() -> (Env, AuraVaultClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signer = Address::generate(&env);
    let mut signers: Vec<Address> = Vec::new(&env);
    signers.push_back(signer.clone());
    vault.initialize(&admin, &token, &signers, &0_u32);
    (env, vault, admin, token, signer)
}

#[test]
fn share_transfer_and_allowance_keep_balances_consistent() {
    let (env, vault, admin, token, _signer) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let spender = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&alice, &1_000);
    vault.deposit(&alice, &1_000);

    vault.transfer(&alice, &bob, &250);
    assert_eq!(vault.balance_of(&alice), 750);
    assert_eq!(vault.balance_of(&bob), 250);

    vault.approve(&alice, &spender, &300, &100);
    assert_eq!(vault.allowance(&alice, &spender), 300);
    vault.transfer_from(&spender, &alice, &bob, &200);
    assert_eq!(vault.allowance(&alice, &spender), 100);
    assert_eq!(vault.balance_of(&alice), 550);
    assert_eq!(vault.balance_of(&bob), 450);
    let _ = admin;
}

#[test]
fn proposal_views_report_status_and_unknown_ids() {
    let (env, vault, _admin, _token, signer) = setup();
    assert!(vault.get_proposal(&999).is_none());
    let id = vault.propose_parameter_update(&signer, &Symbol::new(&env, "fee"), &1_i128);
    let proposal = vault.get_proposal(&id).unwrap();
    assert_eq!(proposal.votes, 1);
    assert_eq!(proposal.threshold, 1);
    assert_eq!(proposal.status, ProposalViewStatus::Executable);
    assert_eq!(vault.get_proposals().len(), 1);
}

#[test]
fn unset_router_returns_not_configured() {
    let (env, vault, _admin, _token, _signer) = setup();
    let caller = Address::generate(&env);
    let input = Address::generate(&env);
    let result = vault.try_deposit_with_swap(&caller, &input, &100_i128, &1_i128);
    assert_eq!(result, Err(Ok(VaultError::DexNotConfigured)));
}
