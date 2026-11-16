describe("Wallet Connection", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
  });

  it("shows connect button when wallet is not connected", () => {
    cy.get("[data-cy=connect-wallet-btn]").should("be.visible");
    cy.get("[data-cy=wallet-address]").should("not.exist");
  });

  it("connects wallet and displays truncated address", () => {
    cy.connectWallet();
    cy.get("[data-cy=wallet-address]").should("contain", "GABC12");
  });

  it("disconnects wallet and returns to initial state", () => {
    cy.connectWallet();
    cy.disconnectWallet();
    cy.get("[data-cy=connect-wallet-btn]").should("be.visible");
    cy.get("[data-cy=wallet-address]").should("not.exist");
  });

  it("shows network badge after connecting", () => {
    cy.connectWallet();
    cy.get("[data-cy=network-badge]").should("contain.text", "TESTNET");
  });

  it("hides portfolio section before connecting", () => {
    cy.get("[data-cy=portfolio-section]").should("not.exist");
  });

  it("restores session from sessionStorage", () => {
    // Seed sessionStorage before visiting to simulate restored session
    cy.window().then((win) => {
      win.sessionStorage.setItem(
        "aura_last_wallet",
        JSON.stringify({ address: "GABC1234TESTPUBLICKEY", network: "TESTNET", connected: true })
      );
    });
    cy.reload();
    cy.get("[data-cy=wallet-address]", { timeout: 8000 }).should("be.visible");
    cy.get("[data-cy=network-badge]").should("contain.text", "TESTNET");
  });

  it("persists session key in sessionStorage after connecting", () => {
    cy.connectWallet();
    cy.window().then((win) => {
      const raw = win.sessionStorage.getItem("aura_last_wallet");
      expect(raw).to.not.be.null;
      const parsed = JSON.parse(raw!);
      expect(parsed).to.have.property("address");
      expect(parsed.connected).to.equal(true);
    });
  });

  it("clears session from sessionStorage after disconnecting", () => {
    cy.connectWallet();
    cy.disconnectWallet();
    cy.window().then((win) => {
      const raw = win.sessionStorage.getItem("aura_last_wallet");
      // Either removed entirely or connected flag is false
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        expect(parsed.connected).to.not.equal(true);
      }
    });
  });
});
