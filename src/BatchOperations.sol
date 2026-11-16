// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BatchOperations
 * @dev Handles batch deposit/withdraw operations for gas-efficient multi-user actions
 * 
 * This contract allows admin/keeper to process multiple user actions in a single
 * transaction, significantly reducing gas costs compared to individual calls.
 */
contract BatchOperations is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when a batch deposit is processed
     * @param totalCount Total number of deposits processed
     * @param totalAmount Total amount deposited across all users
     * @param successCount Number of successful deposits
     * @param failureCount Number of failed deposits
     */
    event BatchDeposit(
        uint256 totalCount,
        uint256 totalAmount,
        uint256 successCount,
        uint256 failureCount
    );

    /**
     * @dev Emitted when a batch withdrawal is processed
     * @param totalCount Total number of withdrawals processed
     * @param totalAmount Total amount withdrawn across all users
     * @param successCount Number of successful withdrawals
     * @param failureCount Number of failed withdrawals
     */
    event BatchWithdraw(
        uint256 totalCount,
        uint256 totalAmount,
        uint256 successCount,
        uint256 failureCount
    );

    /**
     * @dev Emitted when a deposit fails for a specific user
     * @param user Address of the user whose deposit failed
     * @param amount Amount that failed to deposit
     * @param reason Error reason
     */
    event DepositFailed(
        address indexed user,
        uint256 amount,
        string reason
    );

    /**
     * @dev Emitted when a withdrawal fails for a specific user
     * @param user Address of the user whose withdrawal failed
     * @param amount Amount that failed to withdraw
     * @param reason Error reason
     */
    event WithdrawFailed(
        address indexed user,
        uint256 amount,
        string reason
    );

    /**
     * @dev Emitted when gas savings are reported
     * @param txGasUsed Gas used by the batch transaction
     * @param estimatedIndividualGas Estimated gas if done individually
     * @param savings Percentage of gas saved
     */
    event GasSavingsReported(
        uint256 txGasUsed,
        uint256 estimatedIndividualGas,
        uint256 savings
    );

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Maximum number of operations per batch
     */
    uint256 public constant MAX_BATCH_SIZE = 50;

    /**
     * @dev Minimum amount for any operation
     */
    uint256 public constant MIN_AMOUNT = 1e6; // 0.01 tokens

    /**
     * @dev Address of the vault contract
     */
    address public vault;

    /**
     * @dev Address of the token used for deposits/withdrawals
     */
    IERC20 public token;

    /**
     * @dev Whether batch operations are enabled
     */
    bool public batchEnabled;

    /**
     * @dev Keeper address authorized to perform batch operations
     */
    address public keeper;

    // ============================================
    # Modifiers
    // ============================================

    /**
     * @dev Modifier to check if batch operations are enabled
     */
    modifier whenBatchEnabled() {
        require(batchEnabled, "BatchOperations: batch operations disabled");
        _;
    }

    /**
     * @dev Modifier to check if caller is keeper or owner
     */
    modifier onlyKeeperOrOwner() {
        require(
            msg.sender == keeper || msg.sender == owner(),
            "BatchOperations: caller is not keeper or owner"
        );
        _;
    }

    /**
     * @dev Modifier to check if vault is not paused
     */
    modifier whenVaultNotPaused() {
        require(!paused(), "BatchOperations: vault paused");
        _;
    }

    // ============================================
    # Constructor
    // ============================================

    /**
     * @dev Constructor initializes the contract
     * @param _vault Address of the vault contract
     * @param _token Address of the token
     */
    constructor(address _vault, address _token) {
        require(_vault != address(0), "BatchOperations: zero vault address");
        require(_token != address(0), "BatchOperations: zero token address");
        
        vault = _vault;
        token = IERC20(_token);
        batchEnabled = true;
        keeper = msg.sender;
    }

    // ============================================
    # Core Functions
    // ============================================

    /**
     * @dev Process batch deposits for multiple users
     * @param deposits Array of (user, amount) tuples
     * 
     * Requirements:
     * - Only callable by keeper or owner
     * - Batch must not be empty
     * - Batch size must not exceed MAX_BATCH_SIZE
     * - Each amount must be >= MIN_AMOUNT
     * - Vault must not be paused
     * - Batch operations must be enabled
     */
    function batchDeposit(
        (address, uint256)[] calldata deposits
    ) external 
        nonReentrant 
        whenBatchEnabled 
        whenVaultNotPaused 
        onlyKeeperOrOwner 
    {
        require(deposits.length > 0, "BatchOperations: empty batch");
        require(deposits.length <= MAX_BATCH_SIZE, "BatchOperations: exceeds max batch size");

        uint256 totalAmount = 0;
        uint256 successCount = 0;
        uint256 failureCount = 0;

        // Track gas for reporting
        uint256 startGas = gasleft();

        // Process each deposit
        for (uint256 i = 0; i < deposits.length; i++) {
            (address user, uint256 amount) = deposits[i];

            // Validate amount
            if (amount < MIN_AMOUNT) {
                emit DepositFailed(user, amount, "Amount below minimum");
                failureCount++;
                continue;
            }

            // Validate user address
            if (user == address(0)) {
                emit DepositFailed(user, amount, "Zero address");
                failureCount++;
                continue;
            }

            try this._depositInternal(user, amount) {
                totalAmount += amount;
                successCount++;
            } catch (bytes memory reason) {
                failureCount++;
                string memory reasonStr = _extractRevertReason(reason);
                emit DepositFailed(user, amount, reasonStr);
            }
        }

        // Emit batch event
        emit BatchDeposit(
            deposits.length,
            totalAmount,
            successCount,
            failureCount
        );

        // Report gas savings
        _reportGasSavings(startGas, deposits.length);
    }

    /**
     * @dev Process batch withdrawals for multiple users
     * @param withdrawals Array of (user, amount) tuples
     * 
     * Requirements:
     * - Only callable by keeper or owner
     * - Batch must not be empty
     * - Batch size must not exceed MAX_BATCH_SIZE
     * - Each amount must be >= MIN_AMOUNT
     * - Vault must not be paused
     * - Batch operations must be enabled
     */
    function batchWithdraw(
        (address, uint256)[] calldata withdrawals
    ) external 
        nonReentrant 
        whenBatchEnabled 
        whenVaultNotPaused 
        onlyKeeperOrOwner 
    {
        require(withdrawals.length > 0, "BatchOperations: empty batch");
        require(withdrawals.length <= MAX_BATCH_SIZE, "BatchOperations: exceeds max batch size");

        uint256 totalAmount = 0;
        uint256 successCount = 0;
        uint256 failureCount = 0;

        // Track gas for reporting
        uint256 startGas = gasleft();

        // Process each withdrawal
        for (uint256 i = 0; i < withdrawals.length; i++) {
            (address user, uint256 amount) = withdrawals[i];

            // Validate amount
            if (amount < MIN_AMOUNT) {
                emit WithdrawFailed(user, amount, "Amount below minimum");
                failureCount++;
                continue;
            }

            // Validate user address
            if (user == address(0)) {
                emit WithdrawFailed(user, amount, "Zero address");
                failureCount++;
                continue;
            }

            try this._withdrawInternal(user, amount) {
                totalAmount += amount;
                successCount++;
            } catch (bytes memory reason) {
                failureCount++;
                string memory reasonStr = _extractRevertReason(reason);
                emit WithdrawFailed(user, amount, reasonStr);
            }
        }

        // Emit batch event
        emit BatchWithdraw(
            withdrawals.length,
            totalAmount,
            successCount,
            failureCount
        );

        // Report gas savings
        _reportGasSavings(startGas, withdrawals.length);
    }

    /**
     * @dev Internal deposit function (to be called via try-catch)
     */
    function _depositInternal(address user, uint256 amount) external {
        require(msg.sender == address(this), "BatchOperations: internal call only");
        // This would call the vault's deposit function
        // (IVault(vault).deposit(user, amount);)
        // For demonstration, we emit a success event
        token.safeTransferFrom(user, vault, amount);
    }

    /**
     * @dev Internal withdrawal function (to be called via try-catch)
     */
    function _withdrawInternal(address user, uint256 amount) external {
        require(msg.sender == address(this), "BatchOperations: internal call only");
        // This would call the vault's withdraw function
        // (IVault(vault).withdraw(user, amount);)
        // For demonstration, we emit a success event
        token.safeTransfer(user, amount);
    }

    // ============================================
    # Helper Functions
    // ============================================

    /**
     * @dev Extract revert reason from bytes
     * @param data The revert data
     * @return The revert reason as a string
     */
    function _extractRevertReason(bytes memory data) internal pure returns (string memory) {
        // If the revert data is a string, return it
        if (data.length >= 68) {
            // Check if it's a string error
            if (data[0] == 0x08 && data[1] == 0xc3 && data[2] == 0x79 && data[3] == 0xa0) {
                // Revert with custom error, try to decode
                (string memory reason) = abi.decode(data, (string));
                return reason;
            }
        }
        return "Unknown error";
    }

    /**
     * @dev Report gas savings
     * @param startGas Gas at start of transaction
     * @param operationCount Number of operations in batch
     */
    function _reportGasSavings(uint256 startGas, uint256 operationCount) internal {
        uint256 gasUsed = startGas - gasleft();
        
        // Estimate individual gas cost (approximate: 100k gas per operation)
        uint256 estimatedIndividualGas = operationCount * 100000;
        
        if (estimatedIndividualGas > gasUsed) {
            uint256 savings = ((estimatedIndividualGas - gasUsed) * 100) / estimatedIndividualGas;
            emit GasSavingsReported(gasUsed, estimatedIndividualGas, savings);
        }
    }

    // ============================================
    # View Functions
    // ============================================

    /**
     * @dev Get the current gas price
     * @return Current gas price
     */
    function getGasPrice() external view returns (uint256) {
        return tx.gasprice;
    }

    /**
     * @dev Estimate gas for a batch operation
     * @param operationCount Number of operations in batch
     * @return Estimated gas
     */
    function estimateBatchGas(uint256 operationCount) external pure returns (uint256) {
        if (operationCount == 0) return 0;
        // Base gas + per operation gas
        return 50000 + (operationCount * 25000);
    }

    /**
     * @dev Get the status of an address
     * @param user Address to check
     * @return Whether the address is valid
     */
    function isValidAddress(address user) external pure returns (bool) {
        return user != address(0);
    }

    // ============================================
    # Admin Functions
    // ============================================

    /**
     * @dev Enable or disable batch operations
     * @param enabled New enabled state
     * 
     * Requirements:
     * - Only callable by owner
     */
    function setBatchEnabled(bool enabled) external onlyOwner {
        batchEnabled = enabled;
    }

    /**
     * @dev Set the keeper address
     * @param _keeper New keeper address
     * 
     * Requirements:
     * - Only callable by owner
     * - Keeper address must not be zero
     */
    function setKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "BatchOperations: zero keeper address");
        keeper = _keeper;
    }

    /**
     * @dev Set the vault address
     * @param _vault New vault address
     * 
     * Requirements:
     * - Only callable by owner
     * - Vault address must not be zero
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "BatchOperations: zero vault address");
        vault = _vault;
    }

    /**
     * @dev Set the token address
     * @param _token New token address
     * 
     * Requirements:
     * - Only callable by owner
     * - Token address must not be zero
     */
    function setToken(address _token) external onlyOwner {
        require(_token != address(0), "BatchOperations: zero token address");
        token = IERC20(_token);
    }
}
