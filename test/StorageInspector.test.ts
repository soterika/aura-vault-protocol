import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StorageInspector } from "../typechain-types";

describe("StorageInspector", function () {
  let storageInspector: StorageInspector;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const StorageInspectorFactory = await ethers.getContractFactory("StorageInspector");
    storageInspector = await StorageInspectorFactory.deploy(owner.address);
    await storageInspector.deployed();
  });

  describe("getState", function () {
    it("should return complete vault state", async function () {
      const state = await storageInspector.getState();

      expect(state).to.have.property("totalAssets");
      expect(state).to.have.property("totalShares");
      expect(state).to.have.property("sharePrice");
      expect(state).to.have.property("pendingYield");
      expect(state).to.have.property("isPaused");
      expect(state).to.have.property("admin");
      expect(state).to.have.property("underlyingToken");
      expect(state).to.have.property("version");
      expect(state).to.have.property("createdAt");
      expect(state).to.have.property("updatedAt");
    });

    it("should return correct version", async function () {
      const state = await storageInspector.getState();
      expect(state.version).to.equal("1.0.0");
    });

    it("should return correct admin", async function () {
      const state = await storageInspector.getState();
      expect(state.admin).to.equal(owner.address);
    });

    it("should return correct creation timestamp", async function () {
      const state = await storageInspector.getState();
      expect(state.createdAt).to.be.gt(0);
    });
  });

  describe("getUserState", function () {
    it("should return user state", async function () {
      const userState = await storageInspector.getUserState(user1.address);

      expect(userState.user).to.equal(user1.address);
      expect(userState).to.have.property("balance");
      expect(userState).to.have.property("shares");
      expect(userState).to.have.property("deposited");
      expect(userState).to.have.property("withdrawn");
      expect(userState).to.have.property("rewardsEarned");
      expect(userState).to.have.property("lastInteraction");
    });

    it("should return zero values for non-existent user", async function () {
      const userState = await storageInspector.getUserState(user1.address);
      expect(userState.balance).to.equal(0);
      expect(userState.shares).to.equal(0);
      expect(userState.deposited).to.equal(0);
      expect(userState.withdrawn).to.equal(0);
      expect(userState.rewardsEarned).to.equal(0);
      expect(userState.lastInteraction).to.equal(0);
    });

    it("should return different states for different users", async function () {
      // This would be different in a real implementation
      const state1 = await storageInspector.getUserState(user1.address);
      const state2 = await storageInspector.getUserState(user2.address);
      
      expect(state1.user).to.not.equal(state2.user);
    });
  });

  describe("getSystemHealth", function () {
    it("should return system health status", async function () {
      const health = await storageInspector.getSystemHealth();

      expect(health).to.have.property("isHealthy");
      expect(health).to.have.property("healthScore");
      expect(health).to.have.property("totalUsers");
      expect(health).to.have.property("activeUsers");
      expect(health).to.have.property("averageBalance");
      expect(health).to.have.property("totalValueLocked");
      expect(health).to.have.property("riskLevel");
      expect(health).to.have.property("warnings");
      expect(health).to.have.property("recommendations");
    });

    it("should return health score", async function () {
      const health = await storageInspector.getSystemHealth();
      expect(health.healthScore).to.be.gt(0);
    });

    it("should determine if system is healthy", async function () {
      const health = await storageInspector.getSystemHealth();
      expect(health.isHealthy).to.be.true;
    });
  });

  describe("getBatchUserStates", function () {
    it("should return multiple user states in batch", async function () {
      const users = [user1.address, user2.address];
      const states = await storageInspector.getBatchUserStates(users);

      expect(states).to.have.lengthOf(2);
      expect(states[0].user).to.equal(user1.address);
      expect(states[1].user).to.equal(user2.address);
    });

    it("should handle empty array", async function () {
      const states = await storageInspector.getBatchUserStates([]);
      expect(states).to.have.lengthOf(0);
    });
  });

  describe("individual getters", function () {
    it("should return total assets", async function () {
      const totalAssets = await storageInspector.getTotalAssets();
      expect(totalAssets).to.equal(0);
    });

    it("should return total shares", async function () {
      const totalShares = await storageInspector.getTotalShares();
      expect(totalShares).to.equal(0);
    });

    it("should return share price", async function () {
      const sharePrice = await storageInspector.getSharePrice();
      expect(sharePrice).to.equal(0);
    });

    it("should return pending yield", async function () {
      const pendingYield = await storageInspector.getPendingYield();
      expect(pendingYield).to.equal(0);
    });

    it("should return total yield harvested", async function () {
      const totalYield = await storageInspector.getTotalYieldHarvested();
      expect(totalYield).to.equal(0);
    });

    it("should return last harvest timestamp", async function () {
      const lastHarvest = await storageInspector.getLastHarvestTimestamp();
      expect(lastHarvest).to.equal(0);
    });

    it("should return paused status", async function () {
      const isPaused = await storageInspector.isPaused();
      expect(isPaused).to.be.false;
    });

    it("should return yield paused status", async function () {
      const isYieldPaused = await storageInspector.isYieldPaused();
      expect(isYieldPaused).to.be.false;
    });

    it("should return admin", async function () {
      const admin = await storageInspector.getAdmin();
      expect(admin).to.equal(owner.address);
    });

    it("should return underlying token", async function () {
      const token = await storageInspector.getUnderlyingToken();
      expect(token).to.equal(ethers.constants.AddressZero);
    });

    it("should return version", async function () {
      const version = await storageInspector.getVersion();
      expect(version).to.equal("1.0.0");
    });
  });

  describe("user state getters", function () {
    it("should return user balance", async function () {
      const balance = await storageInspector.getUserBalance(user1.address);
      expect(balance).to.equal(0);
    });

    it("should return user shares", async function () {
      const shares = await storageInspector.getUserShares(user1.address);
      expect(shares).to.equal(0);
    });

    it("should return user deposited", async function () {
      const deposited = await storageInspector.getUserDeposited(user1.address);
      expect(deposited).to.equal(0);
    });

    it("should return user withdrawn", async function () {
      const withdrawn = await storageInspector.getUserWithdrawn(user1.address);
      expect(withdrawn).to.equal(0);
    });

    it("should return user rewards", async function () {
      const rewards = await storageInspector.getUserRewards(user1.address);
      expect(rewards).to.equal(0);
    });

    it("should return user last interaction", async function () {
      const lastInteraction = await storageInspector.getUserLastInteraction(user1.address);
      expect(lastInteraction).to.equal(0);
    });
  });
});
