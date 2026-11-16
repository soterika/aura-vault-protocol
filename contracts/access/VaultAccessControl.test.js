const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VaultAccessControl", function () {
  let vac, admin, strategyManager, operator, support, stranger;

  beforeEach(async function () {
    [admin, strategyManager, operator, support, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("VaultAccessControl");
    vac = await Factory.deploy(admin.address);
    await vac.waitForDeployment();
  });

  // ── Role constants ──────────────────────────────────────────────────────

  it("exposes the correct role constants", async function () {
    expect(await vac.STRATEGY_MANAGER_ROLE()).to.equal(
      ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"))
    );
    expect(await vac.OPERATOR_ROLE()).to.equal(
      ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"))
    );
    expect(await vac.SUPPORT_ROLE()).to.equal(
      ethers.keccak256(ethers.toUtf8Bytes("SUPPORT_ROLE"))
    );
  });

  // ── Constructor / admin setup ───────────────────────────────────────────

  it("grants DEFAULT_ADMIN_ROLE to the deployer", async function () {
    expect(await vac.isAdmin(admin.address)).to.be.true;
  });

  it("does not grant any role to a stranger by default", async function () {
    expect(await vac.isAdmin(stranger.address)).to.be.false;
    expect(await vac.isStrategyManager(stranger.address)).to.be.false;
    expect(await vac.isOperator(stranger.address)).to.be.false;
    expect(await vac.isSupport(stranger.address)).to.be.false;
  });

  // ── Role granting / revoking ────────────────────────────────────────────

  it("admin can grant STRATEGY_MANAGER_ROLE", async function () {
    await vac.connect(admin).grantRole(await vac.STRATEGY_MANAGER_ROLE(), strategyManager.address);
    expect(await vac.isStrategyManager(strategyManager.address)).to.be.true;
  });

  it("admin can grant OPERATOR_ROLE", async function () {
    await vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address);
    expect(await vac.isOperator(operator.address)).to.be.true;
  });

  it("admin can grant SUPPORT_ROLE", async function () {
    await vac.connect(admin).grantRole(await vac.SUPPORT_ROLE(), support.address);
    expect(await vac.isSupport(support.address)).to.be.true;
  });

  it("admin can revoke a role and access is denied afterwards", async function () {
    await vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address);
    await vac.connect(admin).revokeRole(await vac.OPERATOR_ROLE(), operator.address);
    expect(await vac.isOperator(operator.address)).to.be.false;

    await expect(
      vac.connect(operator).triggerEmergency("test")
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  it("non-admin cannot grant roles", async function () {
    await expect(
      vac.connect(stranger).grantRole(await vac.STRATEGY_MANAGER_ROLE(), stranger.address)
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  it("non-admin cannot revoke roles", async function () {
    await vac.connect(admin).grantRole(await vac.SUPPORT_ROLE(), support.address);
    await expect(
      vac.connect(stranger).revokeRole(await vac.SUPPORT_ROLE(), support.address)
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── batchGrantRoles ─────────────────────────────────────────────────────

  it("admin can batch-grant multiple roles", async function () {
    await vac.connect(admin).batchGrantRoles(
      [await vac.STRATEGY_MANAGER_ROLE(), await vac.OPERATOR_ROLE()],
      [strategyManager.address, operator.address]
    );
    expect(await vac.isStrategyManager(strategyManager.address)).to.be.true;
    expect(await vac.isOperator(operator.address)).to.be.true;
  });

  it("batchGrantRoles reverts on length mismatch", async function () {
    await expect(
      vac.connect(admin).batchGrantRoles(
        [await vac.STRATEGY_MANAGER_ROLE()],
        [strategyManager.address, operator.address]
      )
    ).to.be.revertedWith("Length mismatch");
  });

  it("non-admin cannot call batchGrantRoles", async function () {
    await expect(
      vac.connect(stranger).batchGrantRoles([], [])
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── updateVaultConfig ───────────────────────────────────────────────────

  it("admin can call updateVaultConfig and emits VaultConfigUpdated", async function () {
    const param = ethers.encodeBytes32String("feeRate");
    const value = ethers.encodeBytes32String("500");

    await expect(vac.connect(admin).updateVaultConfig(param, value))
      .to.emit(vac, "VaultConfigUpdated")
      .withArgs(admin.address, param, value);
  });

  it("non-admin cannot call updateVaultConfig", async function () {
    const param = ethers.encodeBytes32String("feeRate");
    const value = ethers.encodeBytes32String("500");

    await expect(
      vac.connect(stranger).updateVaultConfig(param, value)
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── deployStrategy ──────────────────────────────────────────────────────

  it("strategy manager can call deployStrategy", async function () {
    await vac.connect(admin).grantRole(await vac.STRATEGY_MANAGER_ROLE(), strategyManager.address);
    // Use a non-zero address as strategy placeholder
    const tx = await vac.connect(strategyManager).deployStrategy(admin.address);
    const receipt = await tx.wait();
    expect(receipt.status).to.equal(1);
  });

  it("deployStrategy reverts for zero address", async function () {
    await vac.connect(admin).grantRole(await vac.STRATEGY_MANAGER_ROLE(), strategyManager.address);
    await expect(
      vac.connect(strategyManager).deployStrategy(ethers.ZeroAddress)
    ).to.be.revertedWith("Zero address");
  });

  it("non-strategy-manager cannot call deployStrategy", async function () {
    await expect(
      vac.connect(stranger).deployStrategy(admin.address)
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── triggerEmergency ────────────────────────────────────────────────────

  it("operator can call triggerEmergency and emits EmergencyTriggered", async function () {
    await vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address);
    await expect(vac.connect(operator).triggerEmergency("flash loan detected"))
      .to.emit(vac, "EmergencyTriggered")
      .withArgs(operator.address, "flash loan detected");
  });

  it("non-operator cannot call triggerEmergency", async function () {
    await expect(
      vac.connect(stranger).triggerEmergency("test")
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── assistUser ──────────────────────────────────────────────────────────

  it("support role can call assistUser and emits SupportActionPerformed", async function () {
    await vac.connect(admin).grantRole(await vac.SUPPORT_ROLE(), support.address);
    const target = stranger.address;
    await expect(vac.connect(support).assistUser(target))
      .to.emit(vac, "SupportActionPerformed")
      .withArgs(support.address, target);
  });

  it("assistUser reverts for zero address", async function () {
    await vac.connect(admin).grantRole(await vac.SUPPORT_ROLE(), support.address);
    await expect(
      vac.connect(support).assistUser(ethers.ZeroAddress)
    ).to.be.revertedWith("Zero address");
  });

  it("non-support cannot call assistUser", async function () {
    await expect(
      vac.connect(stranger).assistUser(admin.address)
    ).to.be.revertedWithCustomError(vac, "AccessControlUnauthorizedAccount");
  });

  // ── Events for role changes (OpenZeppelin emits RoleGranted / RoleRevoked) ──

  it("emits RoleGranted when admin grants a role", async function () {
    await expect(
      vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address)
    ).to.emit(vac, "RoleGranted");
  });

  it("emits RoleRevoked when admin revokes a role", async function () {
    await vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address);
    await expect(
      vac.connect(admin).revokeRole(await vac.OPERATOR_ROLE(), operator.address)
    ).to.emit(vac, "RoleRevoked");
  });

  // ── View helpers ────────────────────────────────────────────────────────

  it("isAdmin / isStrategyManager / isOperator / isSupport reflect current state", async function () {
    await vac.connect(admin).grantRole(await vac.STRATEGY_MANAGER_ROLE(), strategyManager.address);
    await vac.connect(admin).grantRole(await vac.OPERATOR_ROLE(), operator.address);
    await vac.connect(admin).grantRole(await vac.SUPPORT_ROLE(), support.address);

    expect(await vac.isAdmin(admin.address)).to.be.true;
    expect(await vac.isStrategyManager(strategyManager.address)).to.be.true;
    expect(await vac.isOperator(operator.address)).to.be.true;
    expect(await vac.isSupport(support.address)).to.be.true;

    // Revoke and verify
    await vac.connect(admin).revokeRole(await vac.SUPPORT_ROLE(), support.address);
    expect(await vac.isSupport(support.address)).to.be.false;
  });
});
