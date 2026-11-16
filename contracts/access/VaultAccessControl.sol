// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VaultAccessControl
 * @notice RBAC for Aura Vault with Admin, StrategyManager, Operator, and Support roles.
 */
contract VaultAccessControl is AccessControl {
    bytes32 public constant STRATEGY_MANAGER_ROLE = keccak256("STRATEGY_MANAGER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SUPPORT_ROLE = keccak256("SUPPORT_ROLE");

    // --- Events ---
    event VaultConfigUpdated(address indexed by, bytes32 param, bytes32 value);
    event EmergencyTriggered(address indexed by, string reason);
    event SupportActionPerformed(address indexed by, address indexed user);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // Admin is also the initial role admin for all child roles
        _setRoleAdmin(STRATEGY_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(SUPPORT_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // --- Admin-only functions ---

    /// @notice Update a vault configuration parameter.
    function updateVaultConfig(bytes32 param, bytes32 value)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        emit VaultConfigUpdated(msg.sender, param, value);
    }

    /// @notice Grant multiple roles in one call.
    function batchGrantRoles(bytes32[] calldata roles, address[] calldata accounts)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(roles.length == accounts.length, "Length mismatch");
        for (uint256 i; i < roles.length; ++i) {
            _grantRole(roles[i], accounts[i]);
        }
    }

    // --- StrategyManager functions ---

    /// @notice Deploy a new strategy (placeholder — calls the strategy contract).
    function deployStrategy(address strategy)
        external
        onlyRole(STRATEGY_MANAGER_ROLE)
        returns (bool)
    {
        require(strategy != address(0), "Zero address");
        return true;
    }

    // --- Operator functions ---

    /// @notice Trigger emergency mode on the vault.
    function triggerEmergency(string calldata reason)
        external
        onlyRole(OPERATOR_ROLE)
    {
        emit EmergencyTriggered(msg.sender, reason);
    }

    // --- Support functions ---

    /// @notice Perform an assisted action on behalf of a user.
    function assistUser(address user)
        external
        onlyRole(SUPPORT_ROLE)
    {
        require(user != address(0), "Zero address");
        emit SupportActionPerformed(msg.sender, user);
    }

    // --- View helpers ---

    function isAdmin(address account) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function isStrategyManager(address account) external view returns (bool) {
        return hasRole(STRATEGY_MANAGER_ROLE, account);
    }

    function isOperator(address account) external view returns (bool) {
        return hasRole(OPERATOR_ROLE, account);
    }

    function isSupport(address account) external view returns (bool) {
        return hasRole(SUPPORT_ROLE, account);
    }
}
