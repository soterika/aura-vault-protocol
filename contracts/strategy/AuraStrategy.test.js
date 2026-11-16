const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRECISION = ethers.parseEther("1"); // 1e18
const AMOUNT    = ethers.parseEther("1000");

async function deploy(admin, lendingPool, vault) {
  const Factory = await ethers.getContractFactory("AuraStrategy");
  const strategy = await Factory.deploy(admin.address, lendingPool, vault);
  await strategy.waitForDeployment();
  return strategy;
}

async function deployMocks() {
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Underlying", "UND");
  await token.waitForDeployment();

  const Pool = await ethers.getContractFactory("MockLendingPool");
  const pool = await Pool.deploy();
  await pool.waitForDeployment();

  const CTokenF = await ethers.getContractFactory("MockCToken");
  const cToken = await CTokenF.deploy(await token.getAddress());
  await cToken.waitForDeployment();

  return { token, pool, cToken };
}

/** Deploy 5+ distinct ERC-20 tokens for multi-token acceptance tests. */
async function deployFiveTokens() {
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const symbols = ["TKA", "TKB", "TKC", "TKD", "TKE"];
  const tokens = [];
  for (const sym of symbols) {
    const t = await ERC20.deploy(`Token ${sym}`, sym);
    await t.waitForDeployment();
    tokens.push(t);
  }
  return tokens;
}

/** Register tokens[i] on AAVE (no aToken, no cToken) and return addresses. */
async function registerTokens(strategy, stratManager, tokens) {
  for (const t of tokens) {
    await strategy
      .connect(stratManager)
      .addToken(await t.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("AuraStrategy", function () {
  let strategy, token, pool, cToken;
  let admin, vault, operator, stratManager, stranger, alice, bob;

  beforeEach(async function () {
    [admin, vault, operator, stratManager, stranger, alice, bob] =
      await ethers.getSigners();

    ({ token, pool, cToken } = await deployMocks());
    strategy = await deploy(admin, await pool.getAddress(), vault.address);

    await strategy.connect(admin).grantRole(await strategy.OPERATOR_ROLE(), operator.address);
    await strategy.connect(admin).grantRole(await strategy.STRATEGY_MANAGER_ROLE(), stratManager.address);
  });

  // ── Constants ───────────────────────────────────────────────────────────────

  describe("Constants", function () {
    it("MIN_TOKENS is 5", async function () {
      expect(await strategy.MIN_TOKENS()).to.equal(5n);
    });

    it("HARVEST_STALE_THRESHOLD is 48 hours", async function () {
      expect(await strategy.HARVEST_STALE_THRESHOLD()).to.equal(48n * 3600n);
    });

    it("GAS_PER_TOKEN_BUDGET is 60 000", async function () {
      expect(await strategy.GAS_PER_TOKEN_BUDGET()).to.equal(60_000n);
    });
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe("Constructor", function () {
    it("sets the vault address", async function () {
      expect(await strategy.vault()).to.equal(vault.address);
    });

    it("sets the aaveLendingPool address", async function () {
      expect(await strategy.aaveLendingPool()).to.equal(await pool.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
      expect(await strategy.hasRole(await strategy.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it("reverts when lendingPool is zero address", async function () {
      const Factory = await ethers.getContractFactory("AuraStrategy");
      await expect(
        Factory.deploy(admin.address, ethers.ZeroAddress, vault.address)
      ).to.be.revertedWith("Zero address");
    });

    it("reverts when vault is zero address", async function () {
      const Factory = await ethers.getContractFactory("AuraStrategy");
      await expect(
        Factory.deploy(admin.address, await pool.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });
  });

  // ── addToken ────────────────────────────────────────────────────────────────

  describe("addToken", function () {
    it("strategy manager can add a token (AAVE protocol)", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.enabled).to.be.true;
      expect(cfg.active).to.equal(0);
    });

    it("strategy manager can add a token (COMPOUND protocol)", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.active).to.equal(1);
      expect(cfg.cToken).to.equal(await cToken.getAddress());
    });

    it("stores aToken address when provided", async function () {
      const aTokenAddr = ethers.Wallet.createRandom().address;
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, aTokenAddr, 0);
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.aToken).to.equal(aTokenAddr);
    });

    it("emits TokenAdded event", async function () {
      await expect(
        strategy.connect(stratManager)
          .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0)
      ).to.emit(strategy, "TokenAdded").withArgs(await token.getAddress(), 0);
    });

    it("reverts on zero token address", async function () {
      await expect(
        strategy.connect(stratManager)
          .addToken(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 0)
      ).to.be.revertedWith("Zero address");
    });

    it("reverts when adding the same token twice", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await expect(
        strategy.connect(stratManager)
          .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0)
      ).to.be.revertedWith("Already added");
    });

    it("non-strategy-manager cannot add a token", async function () {
      await expect(
        strategy.connect(stranger)
          .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });
  });

  // ── 5+ token registration (acceptance criterion) ────────────────────────────

  describe("5+ token support", function () {
    it("registers 5 distinct tokens without error", async function () {
      const tokens = await deployFiveTokens();
      await registerTokens(strategy, stratManager, tokens);
      expect(await strategy.supportedTokensLength()).to.equal(5n);
    });

    it("registers 7 tokens and all are enabled", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      for (let i = 0; i < 7; i++) {
        const t = await ERC20.deploy(`T${i}`, `T${i}`);
        await t.waitForDeployment();
        await strategy.connect(stratManager)
          .addToken(await t.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      }
      expect(await strategy.supportedTokensLength()).to.equal(7n);
    });

    it("healthCheck.hasMinTokens is false with 4 tokens", async function () {
      const tokens = await deployFiveTokens();
      // Only register 4
      await registerTokens(strategy, stratManager, tokens.slice(0, 4));
      const [, , , , hasMinTokens] = await strategy.healthCheck();
      expect(hasMinTokens).to.be.false;
    });

    it("healthCheck.hasMinTokens is true with exactly 5 tokens", async function () {
      const tokens = await deployFiveTokens();
      await registerTokens(strategy, stratManager, tokens);

      // Harvest once so staleHarvest is false
      await strategy.connect(stratManager).harvest();
      const [, , , , hasMinTokens] = await strategy.healthCheck();
      expect(hasMinTokens).to.be.true;
    });

    it("disabling a token reduces activeTokenCount in healthCheck", async function () {
      const tokens = await deployFiveTokens();
      await registerTokens(strategy, stratManager, tokens);
      await strategy.connect(stratManager).disableToken(await tokens[0].getAddress());
      const [, , activeCount] = await strategy.healthCheck();
      expect(activeCount).to.equal(4n);
    });
  });

  // ── disableToken ────────────────────────────────────────────────────────────

  describe("disableToken", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
    });

    it("emits TokenDisabled", async function () {
      await expect(strategy.connect(stratManager).disableToken(await token.getAddress()))
        .to.emit(strategy, "TokenDisabled")
        .withArgs(await token.getAddress());
    });

    it("disabled token is no longer enabled in config", async function () {
      await strategy.connect(stratManager).disableToken(await token.getAddress());
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.enabled).to.be.false;
    });

    it("reverts when token is not enabled", async function () {
      await expect(
        strategy.connect(stratManager).disableToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Token not enabled");
    });
  });

  // ── Deposit ─────────────────────────────────────────────────────────────────

  describe("deposit (AAVE protocol)", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
    });

    it("moves tokens from vault into the lending pool", async function () {
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
      expect(await token.balanceOf(await pool.getAddress())).to.equal(AMOUNT);
      expect(await token.balanceOf(vault.address)).to.equal(0n);
    });

    it("emits Deposited event with correct args", async function () {
      await expect(strategy.connect(vault).deposit(await token.getAddress(), AMOUNT))
        .to.emit(strategy, "Deposited")
        .withArgs(await token.getAddress(), AMOUNT, 0);
    });

    it("reverts when called by non-vault", async function () {
      await expect(strategy.connect(stranger).deposit(await token.getAddress(), AMOUNT))
        .to.be.revertedWith("Caller not vault");
    });

    it("reverts for zero amount", async function () {
      await expect(strategy.connect(vault).deposit(await token.getAddress(), 0n))
        .to.be.revertedWith("Zero amount");
    });

    it("reverts for unsupported token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("Other", "OTH");
      await expect(strategy.connect(vault).deposit(await other.getAddress(), AMOUNT))
        .to.be.revertedWith("Token not supported");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(strategy.connect(vault).deposit(await token.getAddress(), AMOUNT))
        .to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("reverts in emergency mode", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      await expect(strategy.connect(vault).deposit(await token.getAddress(), AMOUNT))
        .to.be.revertedWith("Emergency mode");
    });

    it("handles multiple deposits accumulating in pool", async function () {
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT * 2n);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
      expect(await token.balanceOf(await pool.getAddress())).to.equal(AMOUNT * 2n);
    });
  });

  describe("deposit (COMPOUND protocol)", function () {
    const DEP = ethers.parseEther("500");

    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      await token.mint(vault.address, DEP);
      await token.connect(vault).approve(await strategy.getAddress(), DEP);
    });

    it("mints cTokens via Compound", async function () {
      await strategy.connect(vault).deposit(await token.getAddress(), DEP);
      expect(await cToken.balanceOf(await strategy.getAddress())).to.equal(DEP);
    });

    it("emits Deposited event with COMPOUND protocol", async function () {
      await expect(strategy.connect(vault).deposit(await token.getAddress(), DEP))
        .to.emit(strategy, "Deposited")
        .withArgs(await token.getAddress(), DEP, 1);
    });
  });

  // ── Withdraw ────────────────────────────────────────────────────────────────

  describe("withdraw (AAVE protocol)", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("returns tokens to vault on full withdrawal", async function () {
      await strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT);
      expect(await token.balanceOf(vault.address)).to.equal(AMOUNT);
    });

    it("returns tokens to vault on partial withdrawal", async function () {
      const half = AMOUNT / 2n;
      await strategy.connect(vault).withdraw(await token.getAddress(), half);
      expect(await token.balanceOf(vault.address)).to.equal(half);
    });

    it("emits Withdrawn event", async function () {
      await expect(strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT))
        .to.emit(strategy, "Withdrawn")
        .withArgs(await token.getAddress(), AMOUNT, 0);
    });

    it("reverts when called by non-vault", async function () {
      await expect(strategy.connect(stranger).withdraw(await token.getAddress(), AMOUNT))
        .to.be.revertedWith("Caller not vault");
    });

    it("reverts for zero amount", async function () {
      await expect(strategy.connect(vault).withdraw(await token.getAddress(), 0n))
        .to.be.revertedWith("Zero amount");
    });

    it("reverts for unsupported token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("Other", "OTH");
      await expect(strategy.connect(vault).withdraw(await other.getAddress(), AMOUNT))
        .to.be.revertedWith("Token not supported");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT))
        .to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("multiple partial withdrawals drain pool correctly", async function () {
      const third = AMOUNT / 3n;
      await strategy.connect(vault).withdraw(await token.getAddress(), third);
      await strategy.connect(vault).withdraw(await token.getAddress(), third);
      const remaining = await token.balanceOf(await pool.getAddress());
      expect(remaining).to.equal(AMOUNT - third * 2n);
    });
  });

  describe("withdraw (COMPOUND protocol)", function () {
    const DEP = ethers.parseEther("400");

    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      await token.mint(vault.address, DEP);
      await token.connect(vault).approve(await strategy.getAddress(), DEP);
      await strategy.connect(vault).deposit(await token.getAddress(), DEP);
    });

    it("redeems cTokens and returns underlying to vault", async function () {
      await strategy.connect(vault).withdraw(await token.getAddress(), DEP);
      expect(await token.balanceOf(vault.address)).to.equal(DEP);
    });

    it("emits Withdrawn with COMPOUND protocol", async function () {
      await expect(strategy.connect(vault).withdraw(await token.getAddress(), DEP))
        .to.emit(strategy, "Withdrawn")
        .withArgs(await token.getAddress(), DEP, 1);
    });
  });

  // ── switchProtocol ──────────────────────────────────────────────────────────

  describe("switchProtocol", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 0);
    });

    it("strategy manager can switch protocol", async function () {
      await strategy.connect(stratManager).switchProtocol(await token.getAddress(), 1);
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.active).to.equal(1);
    });

    it("emits ProtocolSwitched event", async function () {
      await expect(strategy.connect(stratManager).switchProtocol(await token.getAddress(), 1))
        .to.emit(strategy, "ProtocolSwitched")
        .withArgs(await token.getAddress(), 0, 1);
    });

    it("reverts for unregistered token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("X", "X");
      await expect(strategy.connect(stratManager).switchProtocol(await other.getAddress(), 1))
        .to.be.revertedWith("Token not registered");
    });
  });

  // ── Harvest ─────────────────────────────────────────────────────────────────

  describe("harvest", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("updates lastHarvestTimestamp", async function () {
      const before = await strategy.lastHarvestTimestamp();
      await strategy.connect(stratManager).harvest();
      const after = await strategy.lastHarvestTimestamp();
      expect(after).to.be.gt(before);
    });

    it("clears staleHarvest flag after harvest", async function () {
      // Advance time past threshold to set stale flag
      await ethers.provider.send("evm_increaseTime", [49 * 3600]);
      await ethers.provider.send("evm_mine");

      await strategy.connect(stratManager).harvest();
      expect(await strategy.staleHarvest()).to.be.false;
    });

    it("reverts when called by non-strategy-manager", async function () {
      await expect(strategy.connect(stranger).harvest())
        .to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(strategy.connect(stratManager).harvest())
        .to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("reverts in emergency mode", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      await expect(strategy.connect(stratManager).harvest())
        .to.be.revertedWith("Emergency mode");
    });
  });

  // ── Compound yield accrual via MockCToken.accrueInterest ────────────────────

  describe("harvest with Compound yield accrual", function () {
    const DEPOSIT = ethers.parseEther("1000");
    const INTEREST = ethers.parseEther("50");

    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      await token.mint(vault.address, DEPOSIT);
      await token.connect(vault).approve(await strategy.getAddress(), DEPOSIT);
      await strategy.connect(vault).deposit(await token.getAddress(), DEPOSIT);
    });

    it("harvests accrued interest and re-deploys (Compound)", async function () {
      // Simulate interest: mint tokens to cToken contract and inflate cToken balance
      await token.mint(await cToken.getAddress(), INTEREST);
      await cToken.accrueInterest(await strategy.getAddress(), INTEREST);

      await strategy.connect(stratManager).harvest();
      // After harvest the interest is re-deployed: cToken balance = DEPOSIT + INTEREST
      expect(await cToken.balanceOf(await strategy.getAddress())).to.equal(DEPOSIT + INTEREST);
    });
  });

  // ── Emergency withdrawal ────────────────────────────────────────────────────

  describe("emergencyWithdrawAll + rescueFunds", function () {
    beforeEach(async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("pulls all funds to strategy and sets emergencyMode", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      expect(await strategy.emergencyMode()).to.be.true;
      expect(await token.balanceOf(await strategy.getAddress())).to.equal(AMOUNT);
    });

    it("emits EmergencyWithdrawal event", async function () {
      await expect(strategy.connect(operator).emergencyWithdrawAll())
        .to.emit(strategy, "EmergencyWithdrawal")
        .withArgs(await token.getAddress(), AMOUNT);
    });

    it("reverts when called by non-operator", async function () {
      await expect(strategy.connect(stranger).emergencyWithdrawAll())
        .to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });

    it("admin can rescue funds after emergency", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      await strategy.connect(admin).rescueFunds(await token.getAddress(), stranger.address);
      expect(await token.balanceOf(stranger.address)).to.equal(AMOUNT);
    });

    it("rescueFunds reverts when not in emergency", async function () {
      await expect(strategy.connect(admin).rescueFunds(await token.getAddress(), stranger.address))
        .to.be.revertedWith("Not in emergency");
    });

    it("rescueFunds reverts when balance is zero", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      // Rescue once to empty the balance
      await strategy.connect(admin).rescueFunds(await token.getAddress(), stranger.address);
      await expect(strategy.connect(admin).rescueFunds(await token.getAddress(), stranger.address))
        .to.be.revertedWith("Nothing to rescue");
    });
  });

  describe("emergencyWithdrawAll — gas measurement (5 tokens)", function () {
    it("stays under 300 000 gas for 5 Compound tokens", async function () {
      const ERC20    = await ethers.getContractFactory("MockERC20");
      const CTokenF  = await ethers.getContractFactory("MockCToken");
      const DEP      = ethers.parseEther("100");
      const tokens   = [];
      const cTokens  = [];

      for (let i = 0; i < 5; i++) {
        const t  = await ERC20.deploy(`T${i}`, `T${i}`);
        await t.waitForDeployment();
        const ct = await CTokenF.deploy(await t.getAddress());
        await ct.waitForDeployment();

        await strategy.connect(stratManager)
          .addToken(await t.getAddress(), await ct.getAddress(), ethers.ZeroAddress, 1);

        await t.mint(vault.address, DEP);
        await t.connect(vault).approve(await strategy.getAddress(), DEP);
        await strategy.connect(vault).deposit(await t.getAddress(), DEP);

        tokens.push(t);
        cTokens.push(ct);
      }

      const tx      = await strategy.connect(operator).emergencyWithdrawAll();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;

      // Must be under 300 000 to satisfy acceptance criterion.
      expect(gasUsed).to.be.lt(300_000n, `emergencyWithdrawAll used ${gasUsed} gas`);
    });
  });

  // ── healthCheck ─────────────────────────────────────────────────────────────

  describe("healthCheck", function () {
    it("is unhealthy with no tokens registered", async function () {
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.false;
    });

    it("is healthy after registering 5 tokens and harvesting", async function () {
      const tokens = await deployFiveTokens();
      await registerTokens(strategy, stratManager, tokens);
      await strategy.connect(stratManager).harvest();
      const [healthy, , activeCount, isStale, hasMin] = await strategy.healthCheck();
      expect(healthy).to.be.true;
      expect(activeCount).to.equal(5n);
      expect(isStale).to.be.false;
      expect(hasMin).to.be.true;
    });

    it("reports totalDeployed after a Compound deposit", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), ethers.ZeroAddress, 1);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);

      const [, totalDeployed] = await strategy.healthCheck();
      expect(totalDeployed).to.equal(AMOUNT);
    });

    it("becomes unhealthy after emergencyWithdrawAll", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await strategy.connect(operator).emergencyWithdrawAll();
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.false;
    });

    it("staleHarvest is true when harvest has never run", async function () {
      const [, , , isStale] = await strategy.healthCheck();
      expect(isStale).to.be.true;
    });

    it("staleHarvest is false right after harvest", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await strategy.connect(stratManager).harvest();
      const [, , , isStale] = await strategy.healthCheck();
      expect(isStale).to.be.false;
    });

    it("staleHarvest becomes true after HARVEST_STALE_THRESHOLD passes", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await strategy.connect(stratManager).harvest();

      // Advance time past the 48-hour threshold
      await ethers.provider.send("evm_increaseTime", [49 * 3600]);
      await ethers.provider.send("evm_mine");

      const [, , , isStale] = await strategy.healthCheck();
      expect(isStale).to.be.true;
    });

    it("emits StaleHarvestDetected when harvest is stale", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await strategy.connect(stratManager).harvest();

      await ethers.provider.send("evm_increaseTime", [49 * 3600]);
      await ethers.provider.send("evm_mine");

      await expect(strategy.healthCheck()).to.emit(strategy, "StaleHarvestDetected");
    });

    it("emits InsufficientTokensDetected when fewer than 5 tokens active", async function () {
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await expect(strategy.healthCheck()).to.emit(strategy, "InsufficientTokensDetected");
    });

    it("staleHarvest public flag is updated by healthCheck", async function () {
      // Initially stale (never harvested)
      await strategy.healthCheck();
      expect(await strategy.staleHarvest()).to.be.true;

      // Harvest and re-check
      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
      await strategy.connect(stratManager).harvest();
      await strategy.healthCheck();
      expect(await strategy.staleHarvest()).to.be.false;
    });

    it("healthy is false when paused (even with 5 tokens and fresh harvest)", async function () {
      const tokens = await deployFiveTokens();
      await registerTokens(strategy, stratManager, tokens);
      await strategy.connect(stratManager).harvest();
      await strategy.connect(operator).pause();
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.false;
    });
  });

  // ── Pause / Unpause ─────────────────────────────────────────────────────────

  describe("pause / unpause", function () {
    it("operator can pause and unpause", async function () {
      await strategy.connect(operator).pause();
      expect(await strategy.paused()).to.be.true;
      await strategy.connect(operator).unpause();
      expect(await strategy.paused()).to.be.false;
    });

    it("non-operator cannot pause", async function () {
      await expect(strategy.connect(stranger).pause())
        .to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });
  });

  // ── updateShares ────────────────────────────────────────────────────────────

  describe("updateShares", function () {
    it("vault can set share balances", async function () {
      await strategy.connect(vault).updateShares(alice.address, 1000n, 1000n);
      expect(await strategy.shareBalance(alice.address)).to.equal(1000n);
      expect(await strategy.totalShares()).to.equal(1000n);
    });

    it("non-vault cannot call updateShares", async function () {
      await expect(strategy.connect(stranger).updateShares(alice.address, 100n, 100n))
        .to.be.revertedWith("Caller not vault");
    });
  });

  // ── distributeYield ─────────────────────────────────────────────────────────

  describe("distributeYield", function () {
    const SHARES = ethers.parseEther("1000");
    const YIELD  = ethers.parseEther("100");

    beforeEach(async function () {
      await strategy.connect(vault).updateShares(alice.address, SHARES, SHARES);
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
    });

    it("distributes yield and emits YieldDistributed", async function () {
      await expect(strategy.connect(admin).distributeYield(await token.getAddress(), YIELD))
        .to.emit(strategy, "YieldDistributed")
        .withArgs(await token.getAddress(), YIELD, SHARES);
    });

    it("increases yieldPerShareAccumulator correctly", async function () {
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
      const acc = await strategy.yieldPerShareAccumulator(await token.getAddress());
      expect(acc).to.equal((YIELD * PRECISION) / SHARES);
    });

    it("reverts when there are no shares", async function () {
      await strategy.connect(vault).updateShares(alice.address, 0n, 0n);
      await expect(strategy.connect(admin).distributeYield(await token.getAddress(), YIELD))
        .to.be.revertedWith("No shares");
    });

    it("reverts for zero amount", async function () {
      await expect(strategy.connect(admin).distributeYield(await token.getAddress(), 0n))
        .to.be.revertedWith("Zero amount");
    });

    it("two distributions accumulate correctly", async function () {
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
      const acc = await strategy.yieldPerShareAccumulator(await token.getAddress());
      expect(acc).to.equal((YIELD * 2n * PRECISION) / SHARES);
    });
  });

  // ── claimYield + pendingYield ────────────────────────────────────────────────

  describe("claimYield / pendingYield", function () {
    const ALICE_SHARES = ethers.parseEther("600");
    const BOB_SHARES   = ethers.parseEther("400");
    const TOTAL_SHARES = ALICE_SHARES + BOB_SHARES;
    const YIELD        = ethers.parseEther("100");

    beforeEach(async function () {
      await strategy.connect(vault).updateShares(alice.address, ALICE_SHARES, TOTAL_SHARES);
      await strategy.connect(vault).updateShares(bob.address,   BOB_SHARES,   TOTAL_SHARES);
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
    });

    it("pendingYield is proportional to shares", async function () {
      const alicePending = await strategy.pendingYield(alice.address, await token.getAddress());
      const bobPending   = await strategy.pendingYield(bob.address,   await token.getAddress());
      expect(alicePending).to.equal((YIELD * ALICE_SHARES) / TOTAL_SHARES);
      expect(bobPending).to.equal((YIELD * BOB_SHARES) / TOTAL_SHARES);
    });

    it("alice can claim her yield", async function () {
      const expected = (YIELD * ALICE_SHARES) / TOTAL_SHARES;
      await expect(strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]))
        .to.emit(strategy, "YieldClaimed")
        .withArgs(alice.address, await token.getAddress(), expected);
      expect(await token.balanceOf(alice.address)).to.equal(expected);
    });

    it("pendingYield is zero after claiming", async function () {
      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      expect(await strategy.pendingYield(alice.address, await token.getAddress())).to.equal(0n);
    });

    it("cannot double-claim the same yield", async function () {
      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      const balBefore = await token.balanceOf(alice.address);
      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      expect(await token.balanceOf(alice.address)).to.equal(balBefore);
    });

    it("yield from second distribution is claimable after first is claimed", async function () {
      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
      const expected = (YIELD * ALICE_SHARES) / TOTAL_SHARES;
      expect(await strategy.pendingYield(alice.address, await token.getAddress())).to.equal(expected);
    });

    it("shareholder with zero shares has zero pending yield", async function () {
      expect(await strategy.pendingYield(stranger.address, await token.getAddress())).to.equal(0n);
    });

    it("total claimed equals total distributed (alice + bob)", async function () {
      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      await strategy.connect(bob).claimYield(bob.address,     [await token.getAddress()]);
      const aliceBal = await token.balanceOf(alice.address);
      const bobBal   = await token.balanceOf(bob.address);
      expect(aliceBal + bobBal).to.be.within(YIELD - 1n, YIELD);
    });
  });

  // ── Aave aToken yield accrual via MockAToken ─────────────────────────────────

  describe("Aave yield accrual via MockAToken + MockLendingPoolV2", function () {
    it("healthCheck totalDeployed reflects aToken interest", async function () {
      const PoolV2F  = await ethers.getContractFactory("MockLendingPoolV2");
      const ATokenF  = await ethers.getContractFactory("MockAToken");

      const poolV2  = await PoolV2F.deploy();
      await poolV2.waitForDeployment();

      const aToken  = await ATokenF.deploy(await token.getAddress());
      await aToken.waitForDeployment();

      await poolV2.registerAToken(await token.getAddress(), await aToken.getAddress());

      // Deploy a fresh strategy pointing at poolV2
      const strat2 = await deploy(admin, await poolV2.getAddress(), vault.address);
      await strat2.connect(admin).grantRole(await strat2.OPERATOR_ROLE(),          operator.address);
      await strat2.connect(admin).grantRole(await strat2.STRATEGY_MANAGER_ROLE(),  stratManager.address);

      await strat2.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, await aToken.getAddress(), 0);

      const DEP = ethers.parseEther("1000");
      await token.mint(vault.address, DEP);
      await token.connect(vault).approve(await strat2.getAddress(), DEP);
      await strat2.connect(vault).deposit(await token.getAddress(), DEP);

      // Simulate 50-token interest accrual on the aToken
      const INTEREST = ethers.parseEther("50");
      await aToken.accrueInterest(await strat2.getAddress(), INTEREST);

      const [, totalDeployed] = await strat2.healthCheck();
      expect(totalDeployed).to.equal(DEP + INTEREST);
    });
  });

  // ── Full deposit→yield→withdraw round-trip ───────────────────────────────────

  describe("Round-trip: deposit → yield distribution → withdraw", function () {
    it("vault user receives principal plus proportional yield", async function () {
      const DEPOSIT = ethers.parseEther("1000");
      const YIELD   = ethers.parseEther("200");

      await strategy.connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);

      await token.mint(vault.address, DEPOSIT);
      await token.connect(vault).approve(await strategy.getAddress(), DEPOSIT);
      await strategy.connect(vault).deposit(await token.getAddress(), DEPOSIT);

      await strategy.connect(vault).updateShares(alice.address, DEPOSIT, DEPOSIT);

      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);

      await strategy.connect(alice).claimYield(alice.address, [await token.getAddress()]);
      expect(await token.balanceOf(alice.address)).to.equal(YIELD);

      await strategy.connect(vault).withdraw(await token.getAddress(), DEPOSIT);
      expect(await token.balanceOf(vault.address)).to.equal(DEPOSIT);
    });
  });

  // ── 5-token round-trip ───────────────────────────────────────────────────────

  describe("Round-trip with 5 tokens (acceptance criterion)", function () {
    it("deposits and withdraws across 5 tokens correctly", async function () {
      const tokens = await deployFiveTokens();
      const DEP = ethers.parseEther("200");

      for (const t of tokens) {
        await strategy.connect(stratManager)
          .addToken(await t.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress, 0);
        await t.mint(vault.address, DEP);
        await t.connect(vault).approve(await strategy.getAddress(), DEP);
        await strategy.connect(vault).deposit(await t.getAddress(), DEP);
      }

      // Withdraw each token back
      for (const t of tokens) {
        await strategy.connect(vault).withdraw(await t.getAddress(), DEP);
        expect(await t.balanceOf(vault.address)).to.equal(DEP);
      }
    });
  });
});
