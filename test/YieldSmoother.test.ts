import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { YieldSmoother } from "../typechain-types";

describe("YieldSmoother", function () {
  let yieldSmoother: YieldSmoother;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  const YIELD_AMOUNT = ethers.utils.parseEther("1000");
  const DRIP_PERIOD = 6 * 3600; // 6 hours

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    const YieldSmootherFactory = await ethers.getContractFactory("YieldSmoother");
    yieldSmoother = await YieldSmootherFactory.deploy();
    await yieldSmoother.deployed();
  });

  describe("addYield", function () {
    it("should add yield to pending", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);

      expect(await yieldSmoother.pendingYield()).to.equal(YIELD_AMOUNT);
      expect(await yieldSmoother.totalYieldAdded()).to.equal(YIELD_AMOUNT);
    });

    it("should calculate drip rate correctly", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);

      const dripRate = await yieldSmoother.dripRate();
      const expectedRate = YIELD_AMOUNT.div(DRIP_PERIOD);
      expect(dripRate).to.be.closeTo(expectedRate, ethers.utils.parseEther("0.01"));
    });

    it("should emit YieldAdded event", async function () {
      await expect(
        yieldSmoother.connect(owner).addYield(YIELD_AMOUNT)
      ).to.emit(yieldSmoother, "YieldAdded")
        .withArgs(
          YIELD_AMOUNT,
          YIELD_AMOUNT,
          await ethers.provider.getBlock("latest").then(b => b.timestamp).then(ts => ts + DRIP_PERIOD),
          YIELD_AMOUNT.div(DRIP_PERIOD)
        );
    });

    it("should reject zero yield amount", async function () {
      await expect(
        yieldSmoother.connect(owner).addYield(0)
      ).to.be.revertedWithCustomError(yieldSmoother, "ZeroYieldAmount");
    });

    it("should reject amount below minimum", async function () {
      const smallAmount = ethers.utils.parseEther("0.001");
      await expect(
        yieldSmoother.connect(owner).addYield(smallAmount)
      ).to.be.revertedWith("YieldSmoother: amount too small");
    });

    it("should extend drip period when adding more yield", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      const firstEnd = await yieldSmoother.dripEndTimestamp();
      
      // Fast forward 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const secondAmount = YIELD_AMOUNT.div(2);
      await yieldSmoother.connect(owner).addYield(secondAmount);

      const secondEnd = await yieldSmoother.dripEndTimestamp();
      expect(secondEnd).to.be.gt(firstEnd);
    });
  });

  describe("dripYield", function () {
    it("should drip yield over time", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);

      // Fast forward 3 hours (half of drip period)
      await ethers.provider.send("evm_increaseTime", [3 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const dripped = await yieldSmoother.callStatic.dripYield();
      await yieldSmoother.dripYield();

      // Should have dripped approximately half
      expect(dripped).to.be.closeTo(YIELD_AMOUNT.div(2), ethers.utils.parseEther("10"));
    });

    it("should drip all yield after full period", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);

      // Fast forward 7 hours (past drip period)
      await ethers.provider.send("evm_increaseTime", [7 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const dripped = await yieldSmoother.callStatic.dripYield();
      await yieldSmoother.dripYield();

      expect(dripped).to.equal(YIELD_AMOUNT);
      expect(await yieldSmoother.pendingYield()).to.equal(0);
    });

    it("should emit YieldDripped event", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);

      await ethers.provider.send("evm_increaseTime", [3 * 3600]);
      await ethers.provider.send("evm_mine", []);

      await expect(yieldSmoother.dripYield())
        .to.emit(yieldSmoother, "YieldDripped");
    });
  });

  describe("view functions", function () {
    it("should return pending yield", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      expect(await yieldSmoother.getPendingYield()).to.equal(YIELD_AMOUNT);
    });

    it("should return drip rate", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      const rate = await yieldSmoother.getDripRate();
      expect(rate).to.be.gt(0);
    });

    it("should return drip progress", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      // 50% progress
      await ethers.provider.send("evm_increaseTime", [3 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const progress = await yieldSmoother.getDripProgress();
      expect(progress).to.be.closeTo(50, 5);
    });

    it("should return yield stats", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      const [totalAdded, totalDripped, pending] = await yieldSmoother.getYieldStats();
      expect(totalAdded).to.equal(YIELD_AMOUNT);
      expect(totalDripped).to.equal(0);
      expect(pending).to.equal(YIELD_AMOUNT);
    });

    it("should calculate dripped amount at timestamp", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      const futureTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 3 * 3600;
      const drippedAt = await yieldSmoother.getDrippedAmountAt(futureTimestamp);
      
      expect(drippedAt).to.be.closeTo(YIELD_AMOUNT.div(2), ethers.utils.parseEther("10"));
    });
  });

  describe("pause functionality", function () {
    it("should pause yield", async function () {
      await yieldSmoother.connect(owner).pauseYield();
      expect(await yieldSmoother.yieldPaused()).to.be.true;
    });

    it("should emit event when paused", async function () {
      await expect(yieldSmoother.connect(owner).pauseYield())
        .to.emit(yieldSmoother, "YieldPaused");
    });

    it("should not allow adding yield when paused", async function () {
      await yieldSmoother.connect(owner).pauseYield();
      await expect(
        yieldSmoother.connect(owner).addYield(YIELD_AMOUNT)
      ).to.be.revertedWith("YieldSmoother: yield paused");
    });

    it("should unpause yield", async function () {
      await yieldSmoother.connect(owner).pauseYield();
      await yieldSmoother.connect(owner).unpauseYield();
      expect(await yieldSmoother.yieldPaused()).to.be.false;
    });

    it("should apply full yield when vault is paused", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      await yieldSmoother.connect(owner).pause();
      
      const dripped = await yieldSmoother.callStatic.dripYield();
      await yieldSmoother.dripYield();
      
      // Should have dripped all yield when vault is paused
      expect(dripped).to.equal(YIELD_AMOUNT);
      expect(await yieldSmoother.pendingYield()).to.equal(0);
    });
  });

  describe("admin functions", function () {
    it("should allow owner to set drip period", async function () {
      const newPeriod = 12 * 3600; // 12 hours
      await yieldSmoother.connect(owner).setDripPeriod(newPeriod);
      expect(await yieldSmoother.dripPeriod()).to.equal(newPeriod);
    });

    it("should reject invalid drip period (too short)", async function () {
      await expect(
        yieldSmoother.connect(owner).setDripPeriod(30)
      ).to.be.revertedWithCustomError(yieldSmoother, "InvalidDripPeriod");
    });

    it("should reject invalid drip period (too long)", async function () {
      await expect(
        yieldSmoother.connect(owner).setDripPeriod(8 * 24 * 3600)
      ).to.be.revertedWithCustomError(yieldSmoother, "InvalidDripPeriod");
    });

    it("should allow owner to force apply yield", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      await yieldSmoother.connect(owner).forceApplyYield();
      
      expect(await yieldSmoother.pendingYield()).to.equal(0);
      expect(await yieldSmoother.totalYieldDripped()).to.equal(YIELD_AMOUNT);
    });

    it("should allow owner to reset yield state", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      await yieldSmoother.connect(owner).resetYieldState();
      
      expect(await yieldSmoother.pendingYield()).to.equal(0);
      expect(await yieldSmoother.dripRate()).to.equal(0);
      expect(await yieldSmoother.dripStartTimestamp()).to.equal(0);
      expect(await yieldSmoother.dripEndTimestamp()).to.equal(0);
    });

    it("should not allow non-owner to set drip period", async function () {
      await expect(
        yieldSmoother.connect(user).setDripPeriod(3600)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("gas efficiency", function () {
    it("should be gas efficient for multiple drips", async function () {
      await yieldSmoother.connect(owner).addYield(YIELD_AMOUNT);
      
      const tx1 = await yieldSmoother.dripYield();
      const receipt1 = await tx1.wait();
      const gas1 = receipt1.gasUsed.toNumber();

      // Fast forward 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const tx2 = await yieldSmoother.dripYield();
      const receipt2 = await tx2.wait();
      const gas2 = receipt2.gasUsed.toNumber();

      // Gas usage should be reasonable and similar
      expect(gas1).to.be.lessThan(200000);
      expect(gas2).to.be.lessThan(200000);
    });
  });
});
