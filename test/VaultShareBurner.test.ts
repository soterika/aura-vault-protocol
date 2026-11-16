import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { VaultShareBurner } from "../typechain-types";

describe("VaultShareBurner", function () {
  let vaultShareBurner: VaultShareBurner;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let admin: SignerWithAddress;

  const INITIAL_TOTAL_SHARES = ethers.utils.parseEther("1000000");

  beforeEach(async function () {
    [owner, user1, user2, admin] = await ethers.getSigners();

    const VaultShareBurnerFactory = await ethers.getContractFactory("VaultShareBurner");
    vaultShareBurner = await VaultShareBurnerFactory.deploy(INITIAL_TOTAL_SHARES);
    await vaultShareBurner.deployed();

    // Mint shares to users
    await vaultShareBurner.connect(owner).mint(user1.address, ethers.utils.parseEther("1000"));
    await vaultShareBurner.connect(owner).mint(user2.address, ethers.utils.parseEther("500"));
  });

  describe("burn", function () {
    it("should allow user to burn their own shares", async function () {
      const burnAmount = ethers.utils.parseEther("100");
      await vaultShareBurner.connect(user1).burn(burnAmount);

      expect(await vaultShareBurner.balanceOf(user1.address)).to.equal(
        ethers.utils.parseEther("900")
      );
      expect(await vaultShareBurner.totalShares()).to.equal(
        INITIAL_TOTAL_SHARES.sub(burnAmount)
      );
    });

    it("should emit Burned event on successful burn", async function () {
      const burnAmount = ethers.utils.parseEther("100");
      await expect(vaultShareBurner.connect(user1).burn(burnAmount))
        .to.emit(vaultShareBurner, "Burned")
        .withArgs(
          user1.address,
          burnAmount,
          INITIAL_TOTAL_SHARES.sub(burnAmount),
          await ethers.provider.getBlock("latest").then(b => b.timestamp)
        );
    });

    it("should not allow burning zero shares", async function () {
      await expect(
        vaultShareBurner.connect(user1).burn(0)
      ).to.be.revertedWith("VaultShareBurner: cannot burn zero shares");
    });

    it("should not allow burning more than caller holds", async function () {
      const burnAmount = ethers.utils.parseEther("2000");
      await expect(
        vaultShareBurner.connect(user1).burn(burnAmount)
      ).to.be.revertedWith("VaultShareBurner: insufficient shares");
    });

    it("should not allow burning more than max per transaction", async function () {
      const burnAmount = ethers.utils.parseEther("15000000");
      await expect(
        vaultShareBurner.connect(user1).burn(burnAmount)
      ).to.be.revertedWith("VaultShareBurner: exceeds max burn per tx");
    });

    it("should not allow burning if vault is paused", async function () {
      await vaultShareBurner.connect(owner).pause();
      
      await expect(
        vaultShareBurner.connect(user1).burn(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("VaultShareBurner: vault paused");
    });

    it("should not allow burning if burning is paused", async function () {
      await vaultShareBurner.connect(owner).setBurningPaused(true);
      
      await expect(
        vaultShareBurner.connect(user1).burn(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("VaultShareBurner: burning paused");
    });

    it("should not allow burning if it would leave too few shares", async function () {
      // Try to burn almost all shares
      const burnAmount = INITIAL_TOTAL_SHARES.sub(ethers.utils.parseEther("0.5"));
      await expect(
        vaultShareBurner.connect(user1).burn(burnAmount)
      ).to.be.revertedWith("VaultShareBurner: would leave too few shares");
    });
  });

  describe("balanceOf", function () {
    it("should return correct balance", async function () {
      const balance = await vaultShareBurner.balanceOf(user1.address);
      expect(balance).to.equal(ethers.utils.parseEther("1000"));
    });

    it("should return 0 for address with no shares", async function () {
      const balance = await vaultShareBurner.balanceOf(admin.address);
      expect(balance).to.equal(0);
    });
  });

  describe("totalShares", function () {
    it("should return correct total shares", async function () {
      expect(await vaultShareBurner.totalShares()).to.equal(INITIAL_TOTAL_SHARES);
    });

    it("should decrease after burning", async function () {
      const burnAmount = ethers.utils.parseEther("100");
      await vaultShareBurner.connect(user1).burn(burnAmount);
      expect(await vaultShareBurner.totalShares()).to.equal(
        INITIAL_TOTAL_SHARES.sub(burnAmount)
      );
    });
  });

  describe("getSharePrice", function () {
    it("should calculate correct share price", async function () {
      const totalValue = ethers.utils.parseEther("1000000");
      const sharePrice = await vaultShareBurner.getSharePrice(totalValue);
      
      // Price = totalValue * 1e18 / totalShares
      const expectedPrice = totalValue.mul(ethers.utils.parseEther("1")).div(INITIAL_TOTAL_SHARES);
      expect(sharePrice).to.equal(expectedPrice);
    });

    it("should return 0 when total shares is 0", async function () {
      // This would require burning all shares, which is not allowed
      // So we test with a fresh contract that has 0 shares
      const EmptyFactory = await ethers.getContractFactory("VaultShareBurner");
      const emptyBurner = await EmptyFactory.deploy(0);
      await emptyBurner.deployed();

      const sharePrice = await emptyBurner.getSharePrice(ethers.utils.parseEther("1000"));
      expect(sharePrice).to.equal(0);
    });
  });

  describe("canBurn", function () {
    it("should return true if user has shares and burning is enabled", async function () {
      expect(await vaultShareBurner.canBurn(user1.address)).to.be.true;
    });

    it("should return false if user has no shares", async function () {
      expect(await vaultShareBurner.canBurn(admin.address)).to.be.false;
    });

    it("should return false if burning is paused", async function () {
      await vaultShareBurner.connect(owner).setBurningPaused(true);
      expect(await vaultShareBurner.canBurn(user1.address)).to.be.false;
    });
  });

  describe("getRemainingAfterBurn", function () {
    it("should return correct remaining shares", async function () {
      const burnAmount = ethers.utils.parseEther("100");
      const remaining = await vaultShareBurner.getRemainingAfterBurn(
        user1.address,
        burnAmount
      );
      expect(remaining).to.equal(ethers.utils.parseEther("900"));
    });

    it("should return 0 if burning more than balance", async function () {
      const burnAmount = ethers.utils.parseEther("2000");
      const remaining = await vaultShareBurner.getRemainingAfterBurn(
        user1.address,
        burnAmount
      );
      expect(remaining).to.equal(0);
    });
  });

  describe("batchBurn", function () {
    it("should allow admin to burn multiple accounts", async function () {
      const accounts = [user1.address, user2.address];
      const amounts = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("50")
      ];

      await vaultShareBurner.connect(owner).batchBurn(accounts, amounts);

      expect(await vaultShareBurner.balanceOf(user1.address)).to.equal(
        ethers.utils.parseEther("900")
      );
      expect(await vaultShareBurner.balanceOf(user2.address)).to.equal(
        ethers.utils.parseEther("450")
      );
      expect(await vaultShareBurner.totalShares()).to.equal(
        INITIAL_TOTAL_SHARES.sub(ethers.utils.parseEther("150"))
      );
    });

    it("should revert if arrays length mismatch", async function () {
      const accounts = [user1.address];
      const amounts = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("50")
      ];

      await expect(
        vaultShareBurner.connect(owner).batchBurn(accounts, amounts)
      ).to.be.revertedWith("VaultShareBurner: arrays length mismatch");
    });

    it("should revert if not owner", async function () {
      const accounts = [user1.address];
      const amounts = [ethers.utils.parseEther("100")];

      await expect(
        vaultShareBurner.connect(user1).batchBurn(accounts, amounts)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("admin functions", function () {
    it("should allow owner to pause burning", async function () {
      await vaultShareBurner.connect(owner).setBurningPaused(true);
      expect(await vaultShareBurner.burningPaused()).to.be.true;
    });

    it("should emit event when burning paused", async function () {
      await expect(vaultShareBurner.connect(owner).setBurningPaused(true))
        .to.emit(vaultShareBurner, "BurningPaused")
        .withArgs(true);
    });

    it("should allow owner to unpause burning", async function () {
      await vaultShareBurner.connect(owner).setBurningPaused(true);
      await vaultShareBurner.connect(owner).setBurningPaused(false);
      expect(await vaultShareBurner.burningPaused()).to.be.false;
    });

    it("should allow owner to mint shares", async function () {
      const mintAmount = ethers.utils.parseEther("100");
      await vaultShareBurner.connect(owner).mint(admin.address, mintAmount);
      expect(await vaultShareBurner.balanceOf(admin.address)).to.equal(mintAmount);
      expect(await vaultShareBurner.totalShares()).to.equal(
        INITIAL_TOTAL_SHARES.add(mintAmount)
      );
    });

    it("should not allow non-owner to mint", async function () {
      await expect(
        vaultShareBurner.connect(user1).mint(admin.address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
