import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BatchOperations, VaultShareBurner } from "../typechain-types";

describe("BatchOperations", function () {
  let batchOperations: BatchOperations;
  let vault: VaultShareBurner;
  let owner: SignerWithAddress;
  let keeper: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const MAX_BATCH_SIZE = 50;
  const MIN_AMOUNT = ethers.utils.parseEther("0.01");

  beforeEach(async function () {
    [owner, keeper, user1, user2, user3, unauthorized] = await ethers.getSigners();

    // Deploy token (mock)
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    const token = await TokenFactory.deploy("Test Token", "TEST", 18);
    await token.deployed();

    // Deploy vault
    const VaultFactory = await ethers.getContractFactory("VaultShareBurner");
    vault = await VaultFactory.deploy(ethers.utils.parseEther("1000000"));
    await vault.deployed();

    // Deploy batch operations
    const BatchFactory = await ethers.getContractFactory("BatchOperations");
    batchOperations = await BatchFactory.deploy(
      vault.address,
      token.address
    );
    await batchOperations.deployed();

    // Set keeper
    await batchOperations.connect(owner).setKeeper(keeper.address);

    // Mint tokens to users
    await token.mint(user1.address, ethers.utils.parseEther("1000"));
    await token.mint(user2.address, ethers.utils.parseEther("1000"));
    await token.mint(user3.address, ethers.utils.parseEther("1000"));
  });

  describe("batchDeposit", function () {
    it("should process multiple deposits in one transaction", async function () {
      const deposits = [
        [user1.address, ethers.utils.parseEther("100")],
        [user2.address, ethers.utils.parseEther("200")],
        [user3.address, ethers.utils.parseEther("300")],
      ];

      // Approve tokens
      for (const [user, amount] of deposits) {
        await batchOperations.token.approve(batchOperations.address, amount);
      }

      // Execute batch deposit
      const tx = await batchOperations.connect(keeper).batchDeposit(deposits);
      const receipt = await tx.wait();

      // Check events
      const events = receipt.events?.filter(e => e.event === "BatchDeposit");
      expect(events).to.have.lengthOf(1);
      expect(events![0].args.totalCount).to.equal(3);
      expect(events![0].args.totalAmount).to.equal(ethers.utils.parseEther("600"));
      expect(events![0].args.successCount).to.equal(3);
      expect(events![0].args.failureCount).to.equal(0);
    });

    it("should skip failed operations and continue", async function () {
      const deposits = [
        [user1.address, ethers.utils.parseEther("100")],
        [user2.address, ethers.utils.parseEther("0")], // Invalid amount
        [user3.address, ethers.utils.parseEther("300")],
      ];

      // Approve tokens for valid deposits
      await batchOperations.token.approve(user1.address, ethers.utils.parseEther("100"));
      await batchOperations.token.approve(user3.address, ethers.utils.parseEther("300"));

      // Execute batch deposit
      const tx = await batchOperations.connect(keeper).batchDeposit(deposits);
      const receipt = await tx.wait();

      // Check events
      const events = receipt.events?.filter(e => e.event === "BatchDeposit");
      expect(events).to.have.lengthOf(1);
      expect(events![0].args.totalCount).to.equal(3);
      expect(events![0].args.totalAmount).to.equal(ethers.utils.parseEther("400"));
      expect(events![0].args.successCount).to.equal(2);
      expect(events![0].args.failureCount).to.equal(1);

      // Check failed event
      const failedEvents = receipt.events?.filter(e => e.event === "DepositFailed");
      expect(failedEvents).to.have.lengthOf(1);
      expect(failedEvents![0].args.user).to.equal(user2.address);
      expect(failedEvents![0].args.amount).to.equal(ethers.utils.parseEther("0"));
    });

    it("should not allow batch size exceeding MAX_BATCH_SIZE", async function () {
      const deposits = [];
      for (let i = 0; i < 51; i++) {
        deposits.push([user1.address, ethers.utils.parseEther("100")]);
      }

      await expect(
        batchOperations.connect(keeper).batchDeposit(deposits)
      ).to.be.revertedWith("BatchOperations: exceeds max batch size");
    });

    it("should not allow empty batch", async function () {
      await expect(
        batchOperations.connect(keeper).batchDeposit([])
      ).to.be.revertedWith("BatchOperations: empty batch");
    });

    it("should not allow non-keeper to execute", async function () {
      const deposits = [[user1.address, ethers.utils.parseEther("100")]];

      await expect(
        batchOperations.connect(unauthorized).batchDeposit(deposits)
      ).to.be.revertedWith("BatchOperations: caller is not keeper or owner");
    });

    it("should not allow when batch is disabled", async function () {
      await batchOperations.connect(owner).setBatchEnabled(false);
      
      const deposits = [[user1.address, ethers.utils.parseEther("100")]];

      await expect(
        batchOperations.connect(keeper).batchDeposit(deposits)
      ).to.be.revertedWith("BatchOperations: batch operations disabled");
    });

    it("should emit gas savings report", async function () {
      const deposits = [
        [user1.address, ethers.utils.parseEther("100")],
        [user2.address, ethers.utils.parseEther("200")],
        [user3.address, ethers.utils.parseEther("300")],
      ];

      await batchOperations.token.approve(user1.address, ethers.utils.parseEther("100"));
      await batchOperations.token.approve(user2.address, ethers.utils.parseEther("200"));
      await batchOperations.token.approve(user3.address, ethers.utils.parseEther("300"));

      const tx = await batchOperations.connect(keeper).batchDeposit(deposits);
      const receipt = await tx.wait();

      const events = receipt.events?.filter(e => e.event === "GasSavingsReported");
      expect(events).to.have.lengthOf(1);
      expect(events![0].args.txGasUsed).to.be.gt(0);
      expect(events![0].args.estimatedIndividualGas).to.be.gt(0);
      expect(events![0].args.savings).to.be.gt(0);
    });
  });

  describe("batchWithdraw", function () {
    it("should process multiple withdrawals in one transaction", async function () {
      const withdrawals = [
        [user1.address, ethers.utils.parseEther("50")],
        [user2.address, ethers.utils.parseEther("75")],
        [user3.address, ethers.utils.parseEther("25")],
      ];

      const tx = await batchOperations.connect(keeper).batchWithdraw(withdrawals);
      const receipt = await tx.wait();

      const events = receipt.events?.filter(e => e.event === "BatchWithdraw");
      expect(events).to.have.lengthOf(1);
      expect(events![0].args.totalCount).to.equal(3);
      expect(events![0].args.totalAmount).to.equal(ethers.utils.parseEther("150"));
      expect(events![0].args.successCount).to.equal(3);
      expect(events![0].args.failureCount).to.equal(0);
    });

    it("should skip failed withdrawals and continue", async function () {
      const withdrawals = [
        [user1.address, ethers.utils.parseEther("50")],
        [user2.address, ethers.utils.parseEther("0")], // Invalid amount
        [user3.address, ethers.utils.parseEther("25")],
      ];

      const tx = await batchOperations.connect(keeper).batchWithdraw(withdrawals);
      const receipt = await tx.wait();

      const events = receipt.events?.filter(e => e.event === "BatchWithdraw");
      expect(events).to.have.lengthOf(1);
      expect(events![0].args.totalCount).to.equal(3);
      expect(events![0].args.totalAmount).to.equal(ethers.utils.parseEther("75"));
      expect(events![0].args.successCount).to.equal(2);
      expect(events![0].args.failureCount).to.equal(1);

      const failedEvents = receipt.events?.filter(e => e.event === "WithdrawFailed");
      expect(failedEvents).to.have.lengthOf(1);
      expect(failedEvents![0].args.user).to.equal(user2.address);
    });

    it("should not allow batch size exceeding MAX_BATCH_SIZE", async function () {
      const withdrawals = [];
      for (let i = 0; i < 51; i++) {
        withdrawals.push([user1.address, ethers.utils.parseEther("50")]);
      }

      await expect(
        batchOperations.connect(keeper).batchWithdraw(withdrawals)
      ).to.be.revertedWith("BatchOperations: exceeds max batch size");
    });
  });

  describe("admin functions", function () {
    it("should allow owner to set keeper", async function () {
      const newKeeper = await ethers.getSigner(10);
      await batchOperations.connect(owner).setKeeper(newKeeper.address);
      expect(await batchOperations.keeper()).to.equal(newKeeper.address);
    });

    it("should allow owner to set batch enabled state", async function () {
      await batchOperations.connect(owner).setBatchEnabled(false);
      expect(await batchOperations.batchEnabled()).to.be.false;
    });

    it("should allow owner to set vault address", async function () {
      const newVault = await ethers.getSigner(11);
      await batchOperations.connect(owner).setVault(newVault.address);
      expect(await batchOperations.vault()).to.equal(newVault.address);
    });

    it("should not allow non-owner to set keeper", async function () {
      await expect(
        batchOperations.connect(unauthorized).setKeeper(keeper.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("gas efficiency", function () {
    it("should use less gas than individual calls", async function () {
      const deposits = [
        [user1.address, ethers.utils.parseEther("100")],
        [user2.address, ethers.utils.parseEther("200")],
        [user3.address, ethers.utils.parseEther("300")],
      ];

      // Estimate gas for batch call
      const batchTx = await batchOperations.connect(keeper).batchDeposit(deposits);
      const batchReceipt = await batchTx.wait();
      const batchGasUsed = batchReceipt.gasUsed.toNumber();

      // Estimate gas for individual calls (simulated)
      const individualGasPerCall = 100000; // Approximate
      const estimatedIndividualGas = individualGasPerCall * deposits.length;

      // Batch should use less gas
      expect(batchGasUsed).to.be.lessThan(estimatedIndividualGas);
    });
  });
});
