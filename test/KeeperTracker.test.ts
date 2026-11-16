import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { KeeperTracker } from "../typechain-types";

describe("KeeperTracker", function () {
  let keeperTracker: KeeperTracker;
  let owner: SignerWithAddress;
  let keeper1: SignerWithAddress;
  let keeper2: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const YIELD_AMOUNT = ethers.utils.parseEther("100");

  beforeEach(async function () {
    [owner, keeper1, keeper2, unauthorized] = await ethers.getSigners();

    const KeeperTrackerFactory = await ethers.getContractFactory("KeeperTracker");
    keeperTracker = await KeeperTrackerFactory.deploy();
    await keeperTracker.deployed();

    // Register keepers
    await keeperTracker.connect(owner).registerKeeper(keeper1.address);
    await keeperTracker.connect(owner).registerKeeper(keeper2.address);
  });

  describe("trackHarvest", function () {
    it("should track a harvest for a keeper", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);

      const stats = await keeperTracker.getKeeperStats(keeper1.address);
      expect(stats.totalHarvests).to.equal(1);
      expect(stats.totalYieldInjected).to.equal(YIELD_AMOUNT);
      expect(stats.lastHarvestTimestamp).to.be.gt(0);
      expect(stats.lastHarvestAmount).to.equal(YIELD_AMOUNT);
    });

    it("should emit HarvestTriggered event", async function () {
      await expect(
        keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT)
      ).to.emit(keeperTracker, "HarvestTriggered")
        .withArgs(keeper1.address, YIELD_AMOUNT, 1, YIELD_AMOUNT);
    });

    it("should allow multiple harvests from same keeper", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);

      const stats = await keeperTracker.getKeeperStats(keeper1.address);
      expect(stats.totalHarvests).to.equal(2);
      expect(stats.totalYieldInjected).to.equal(YIELD_AMOUNT.mul(2));
    });

    it("should track multiple keepers independently", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      await keeperTracker.connect(keeper2).trackHarvest(keeper2.address, YIELD_AMOUNT.mul(2));

      const stats1 = await keeperTracker.getKeeperStats(keeper1.address);
      const stats2 = await keeperTracker.getKeeperStats(keeper2.address);

      expect(stats1.totalHarvests).to.equal(1);
      expect(stats1.totalYieldInjected).to.equal(YIELD_AMOUNT);
      expect(stats2.totalHarvests).to.equal(1);
      expect(stats2.totalYieldInjected).to.equal(YIELD_AMOUNT.mul(2));
    });

    it("should update global totals", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      await keeperTracker.connect(keeper2).trackHarvest(keeper2.address, YIELD_AMOUNT);

      expect(await keeperTracker.totalHarvests()).to.equal(2);
      expect(await keeperTracker.totalYieldInjected()).to.equal(YIELD_AMOUNT.mul(2));
    });

    it("should reject zero yield amount", async function () {
      await expect(
        keeperTracker.connect(keeper1).trackHarvest(keeper1.address, 0)
      ).to.be.revertedWith("KeeperTracker: zero yield amount");
    });

    it("should reject yield below minimum", async function () {
      const smallYield = ethers.utils.parseEther("0.001");
      await expect(
        keeperTracker.connect(keeper1).trackHarvest(keeper1.address, smallYield)
      ).to.be.revertedWith("KeeperTracker: yield below minimum");
    });

    it("should not allow unauthorized addresses to track harvest", async function () {
      await expect(
        keeperTracker.connect(unauthorized).trackHarvest(unauthorized.address, YIELD_AMOUNT)
      ).to.be.revertedWith("KeeperTracker: caller is not a registered keeper");
    });

    it("should enforce max harvest history", async function () {
      // Track many harvests
      for (let i = 0; i < 1001; i++) {
        await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      }

      const history = await keeperTracker.getHarvestHistory(keeper1.address, 0);
      expect(history.length).to.equal(1000);
    });

    it("should store harvest records with correct data", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);

      const history = await keeperTracker.getHarvestHistory(keeper1.address, 1);
      expect(history[0].keeper).to.equal(keeper1.address);
      expect(history[0].yieldAmount).to.equal(YIELD_AMOUNT);
      expect(history[0].timestamp).to.be.gt(0);
      expect(history[0].blockNumber).to.be.gt(0);
    });
  });

  describe("registerKeeper", function () {
    it("should allow owner to register a keeper", async function () {
      const newKeeper = await ethers.getSigner(10);
      await keeperTracker.connect(owner).registerKeeper(newKeeper.address);
      
      expect(await keeperTracker.isKeeper(newKeeper.address)).to.be.true;
      expect(await keeperTracker.getKeeperCount()).to.equal(3);
    });

    it("should emit KeeperRegistered event", async function () {
      const newKeeper = await ethers.getSigner(10);
      await expect(keeperTracker.connect(owner).registerKeeper(newKeeper.address))
        .to.emit(keeperTracker, "KeeperRegistered")
        .withArgs(newKeeper.address, await ethers.provider.getBlock("latest").then(b => b.timestamp));
    });

    it("should not allow registering already registered keeper", async function () {
      await expect(
        keeperTracker.connect(owner).registerKeeper(keeper1.address)
      ).to.be.revertedWith("KeeperTracker: keeper already registered");
    });

    it("should not allow registering zero address", async function () {
      await expect(
        keeperTracker.connect(owner).registerKeeper(ethers.constants.AddressZero)
      ).to.be.revertedWith("KeeperTracker: zero keeper address");
    });

    it("should not allow non-owner to register", async function () {
      const newKeeper = await ethers.getSigner(10);
      await expect(
        keeperTracker.connect(unauthorized).registerKeeper(newKeeper.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("deregisterKeeper", function () {
    it("should allow owner to deregister a keeper", async function () {
      await keeperTracker.connect(owner).deregisterKeeper(keeper1.address);
      
      expect(await keeperTracker.isKeeper(keeper1.address)).to.be.false;
      expect(await keeperTracker.getKeeperCount()).to.equal(1);
    });

    it("should emit KeeperDeregistered event", async function () {
      await expect(keeperTracker.connect(owner).deregisterKeeper(keeper1.address))
        .to.emit(keeperTracker, "KeeperDeregistered")
        .withArgs(keeper1.address, await ethers.provider.getBlock("latest").then(b => b.timestamp));
    });

    it("should not allow deregistering non-registered keeper", async function () {
      const newKeeper = await ethers.getSigner(10);
      await expect(
        keeperTracker.connect(owner).deregisterKeeper(newKeeper.address)
      ).to.be.revertedWith("KeeperTracker: keeper not registered");
    });

    it("should not allow non-owner to deregister", async function () {
      await expect(
        keeperTracker.connect(unauthorized).deregisterKeeper(keeper1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("batchRegisterKeepers", function () {
    it("should register multiple keepers in batch", async function () {
      const newKeeper1 = await ethers.getSigner(10);
      const newKeeper2 = await ethers.getSigner(11);
      const keepers = [newKeeper1.address, newKeeper2.address];

      await keeperTracker.connect(owner).batchRegisterKeepers(keepers);

      expect(await keeperTracker.isKeeper(newKeeper1.address)).to.be.true;
      expect(await keeperTracker.isKeeper(newKeeper2.address)).to.be.true;
      expect(await keeperTracker.getKeeperCount()).to.equal(4);
    });

    it("should skip invalid addresses in batch", async function () {
      const newKeeper1 = await ethers.getSigner(10);
      const keepers = [newKeeper1.address, ethers.constants.AddressZero];

      await keeperTracker.connect(owner).batchRegisterKeepers(keepers);

      expect(await keeperTracker.isKeeper(newKeeper1.address)).to.be.true;
      expect(await keeperTracker.getKeeperCount()).to.equal(3);
    });
  });

  describe("view functions", function () {
    it("should return keeper stats", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);

      const stats = await keeperTracker.getKeeperStats(keeper1.address);
      expect(stats.totalHarvests).to.equal(1);
      expect(stats.totalYieldInjected).to.equal(YIELD_AMOUNT);
      expect(stats.lastHarvestTimestamp).to.be.gt(0);
      expect(stats.lastHarvestAmount).to.equal(YIELD_AMOUNT);
    });

    it("should return harvest history", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);

      const history = await keeperTracker.getHarvestHistory(keeper1.address, 1);
      expect(history.length).to.equal(1);
      expect(history[0].keeper).to.equal(keeper1.address);
    });

    it("should return all registered keepers", async function () {
      const keepers = await keeperTracker.getRegisteredKeepers();
      expect(keepers).to.deep.equal([keeper1.address, keeper2.address]);
    });

    it("should return keeper count", async function () {
      expect(await keeperTracker.getKeeperCount()).to.equal(2);
    });

    it("should return keeper harvest count", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      expect(await keeperTracker.getKeeperHarvestCount(keeper1.address)).to.equal(1);
    });

    it("should return keeper yield total", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      expect(await keeperTracker.getKeeperYieldTotal(keeper1.address)).to.equal(YIELD_AMOUNT);
    });

    it("should check if address is keeper", async function () {
      expect(await keeperTracker.isKeeper(keeper1.address)).to.be.true;
      expect(await keeperTracker.isKeeper(unauthorized.address)).to.be.false;
    });
  });

  describe("admin functions", function () {
    it("should allow owner to set min yield to track", async function () {
      const newMinYield = ethers.utils.parseEther("0.1");
      await keeperTracker.connect(owner).setMinYieldToTrack(newMinYield);
      expect(await keeperTracker.minYieldToTrack()).to.equal(newMinYield);
    });

    it("should allow owner to reset keeper stats", async function () {
      await keeperTracker.connect(keeper1).trackHarvest(keeper1.address, YIELD_AMOUNT);
      await keeperTracker.connect(owner).resetKeeperStats(keeper1.address);

      const stats = await keeperTracker.getKeeperStats(keeper1.address);
      expect(stats.totalHarvests).to.equal(0);
      expect(stats.totalYieldInjected).to.equal(0);
    });

    it("should not allow non-owner to reset stats", async function () {
      await expect(
        keeperTracker.connect(unauthorized).resetKeeperStats(keeper1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should allow owner to force harvest record", async function () {
      const timestamp = Math.floor(Date.now() / 1000);
      await keeperTracker.connect(owner).forceHarvestRecord(
        keeper1.address,
        YIELD_AMOUNT,
        timestamp
      );

      const stats = await keeperTracker.getKeeperStats(keeper1.address);
      expect(stats.totalHarvests).to.equal(1);
      expect(stats.totalYieldInjected).to.equal(YIELD_AMOUNT);
      expect(stats.lastHarvestTimestamp).to.equal(timestamp);
    });
  });
});
