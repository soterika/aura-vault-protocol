import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { HarvestVerifier } from "../typechain-types";

describe("HarvestVerifier", function () {
  let harvestVerifier: HarvestVerifier;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let token: any;

  const INITIAL_BALANCE = ethers.utils.parseEther("1000");
  const YIELD_AMOUNT = ethers.utils.parseEther("100");

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy mock token
    const TokenFactory = await ethers.getContractFactory("MockERC20");
    token = await TokenFactory.deploy("Test Token", "TEST", 18);
    await token.deployed();

    // Mint initial balance to contract
    await token.mint(owner.address, INITIAL_BALANCE);

    // Deploy harvest verifier
    const VerifierFactory = await ethers.getContractFactory("HarvestVerifier");
    harvestVerifier = await VerifierFactory.deploy(token.address);
    await harvestVerifier.deployed();

    // Transfer initial balance to verifier
    await token.transfer(harvestVerifier.address, INITIAL_BALANCE);
  });

  describe("verifyHarvest", function () {
    it("should verify successful harvest with correct yield", async function () {
      // Create a mock harvest call that increases balance
      const harvestCall = async () => {
        // Simulate yield by minting tokens to the contract
        await token.mint(harvestVerifier.address, YIELD_AMOUNT);
      };

      const actualYield = await harvestVerifier.verifyHarvest(
        YIELD_AMOUNT,
        harvestCall
      );

      expect(actualYield).to.equal(YIELD_AMOUNT);
    });

    it("should revert when yield amount doesn't match balance increase", async function () {
      // Create a mock harvest call that increases balance by wrong amount
      const wrongYield = YIELD_AMOUNT.div(2);
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, wrongYield);
      };

      await expect(
        harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall)
      ).to.be.revertedWithCustomError(harvestVerifier, "YieldNotReceived");
    });

    it("should allow small deviation within tolerance", async function () {
      // Set deviation to 0.05% (5 bps)
      await harvestVerifier.setMaxDeviation(5);

      const actualYield = YIELD_AMOUNT.mul(1005).div(1000); // 0.5% more
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, actualYield);
      };

      const result = await harvestVerifier.verifyHarvest(
        YIELD_AMOUNT,
        harvestCall
      );

      expect(result).to.equal(actualYield);
    });

    it("should revert when deviation exceeds tolerance", async function () {
      // Set deviation to 0.1% (10 bps)
      await harvestVerifier.setMaxDeviation(10);

      const actualYield = YIELD_AMOUNT.mul(1020).div(1000); // 2% more
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, actualYield);
      };

      await expect(
        harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall)
      ).to.be.revertedWithCustomError(harvestVerifier, "YieldNotReceived");
    });

    it("should revert when flash loan is active", async function () {
      // Start flash loan
      await harvestVerifier.startFlashLoan();

      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, YIELD_AMOUNT);
      };

      await expect(
        harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall)
      ).to.be.revertedWithCustomError(harvestVerifier, "FlashLoanActive");
    });

    it("should revert when vault is paused", async function () {
      await harvestVerifier.pause();

      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, YIELD_AMOUNT);
      };

      await expect(
        harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall)
      ).to.be.revertedWith("HarvestVerifier: vault paused");
    });

    it("should reject zero yield amount", async function () {
      const harvestCall = async () => {};

      await expect(
        harvestVerifier.verifyHarvest(0, harvestCall)
      ).to.be.revertedWith("HarvestVerifier: zero yield amount");
    });

    it("should reject yield below minimum", async function () {
      const smallYield = ethers.utils.parseEther("0.001");
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, smallYield);
      };

      await expect(
        harvestVerifier.verifyHarvest(smallYield, harvestCall)
      ).to.be.revertedWith("HarvestVerifier: yield below minimum");
    });

    it("should emit HarvestVerified event on success", async function () {
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, YIELD_AMOUNT);
      };

      const balanceBefore = await harvestVerifier.getTokenBalance();

      await expect(
        harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall)
      ).to.emit(harvestVerifier, "HarvestVerified")
        .withArgs(YIELD_AMOUNT, balanceBefore, balanceBefore.add(YIELD_AMOUNT));
    });
  });

  describe("flash loan guard", function () {
    it("should start flash loan", async function () {
      await harvestVerifier.startFlashLoan();
      expect(await harvestVerifier.isFlashLoanActive()).to.be.true;
    });

    it("should end flash loan", async function () {
      await harvestVerifier.startFlashLoan();
      await harvestVerifier.endFlashLoan();
      expect(await harvestVerifier.isFlashLoanActive()).to.be.false;
    });

    it("should emit event on flash loan start", async function () {
      await expect(harvestVerifier.startFlashLoan())
        .to.emit(harvestVerifier, "FlashLoanDetected")
        .withArgs(true);
    });

    it("should emit event on flash loan end", async function () {
      await harvestVerifier.startFlashLoan();
      await expect(harvestVerifier.endFlashLoan())
        .to.emit(harvestVerifier, "FlashLoanDetected")
        .withArgs(false);
    });

    it("should only allow owner to start flash loan", async function () {
      await expect(
        harvestVerifier.connect(user).startFlashLoan()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should only allow owner to end flash loan", async function () {
      await harvestVerifier.startFlashLoan();
      await expect(
        harvestVerifier.connect(user).endFlashLoan()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("admin functions", function () {
    it("should allow owner to set max deviation", async function () {
      const newDeviation = 50;
      await harvestVerifier.setMaxDeviation(newDeviation);
      expect(await harvestVerifier.maxDeviationBps()).to.equal(newDeviation);
    });

    it("should not allow deviation > 1000 bps", async function () {
      await expect(
        harvestVerifier.setMaxDeviation(1001)
      ).to.be.revertedWith("HarvestVerifier: deviation too high");
    });

    it("should allow owner to set min yield amount", async function () {
      const newMinYield = ethers.utils.parseEther("0.1");
      await harvestVerifier.setMinYieldAmount(newMinYield);
      expect(await harvestVerifier.minYieldAmount()).to.equal(newMinYield);
    });

    it("should allow owner to set token address", async function () {
      const TokenFactory = await ethers.getContractFactory("MockERC20");
      const newToken = await TokenFactory.deploy("New Token", "NEW", 18);
      await newToken.deployed();

      await harvestVerifier.setToken(newToken.address);
      expect(await harvestVerifier.token()).to.equal(newToken.address);
    });

    it("should not allow non-owner to set max deviation", async function () {
      await expect(
        harvestVerifier.connect(user).setMaxDeviation(50)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("view functions", function () {
    it("should return correct token balance", async function () {
      const balance = await harvestVerifier.getTokenBalance();
      expect(balance).to.equal(INITIAL_BALANCE);
    });

    it("should return correct flash loan status", async function () {
      expect(await harvestVerifier.isFlashLoanActive()).to.be.false;
    });

    it("should return last harvest info", async function () {
      const harvestCall = async () => {
        await token.mint(harvestVerifier.address, YIELD_AMOUNT);
      };

      await harvestVerifier.verifyHarvest(YIELD_AMOUNT, harvestCall);

      const [timestamp, amount] = await harvestVerifier.getLastHarvest();
      expect(amount).to.equal(YIELD_AMOUNT);
      expect(timestamp).to.be.gt(0);
    });

    it("should validate harvest", async function () {
      const isValid = await harvestVerifier.isValidHarvest(YIELD_AMOUNT);
      expect(isValid).to.be.true;
    });
  });
});
