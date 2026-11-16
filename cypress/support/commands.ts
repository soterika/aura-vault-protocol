declare global {
  namespace Cypress {
    interface Chainable {
      connectWallet(): Chainable<void>;
      disconnectWallet(): Chainable<void>;
      interceptVaultApis(): Chainable<void>;
    }
  }
}

/** Stub window.freighterApi and trigger connect flow. */
Cypress.Commands.add("connectWallet", () => {
  cy.window().then((win) => {
    (win as any).freighterApi = {
      isConnected: cy.stub().resolves(true),
      getPublicKey: cy.stub().resolves("GABC1234TESTPUBLICKEY"),
      getNetwork: cy.stub().resolves("TESTNET"),
      signTransaction: cy.stub().resolves("signed_xdr"),
    };
  });
  cy.get("[data-cy=connect-wallet-btn]").click();
  cy.get("[data-cy=wallet-address]", { timeout: 8000 }).should("be.visible");
});

Cypress.Commands.add("disconnectWallet", () => {
  cy.get("[data-cy=disconnect-wallet-btn]").click();
  cy.get("[data-cy=connect-wallet-btn]").should("be.visible");
});

/** Stub all vault API endpoints with sensible defaults. */
Cypress.Commands.add("interceptVaultApis", () => {
  cy.intercept("GET", "/api/vault/total_assets", {
    statusCode: 200,
    body: { total: "500000" },
  }).as("totalAssets");

  cy.intercept("GET", "/api/vault/balance_of*", {
    statusCode: 200,
    body: { balance: "1000" },
  }).as("balanceOf");

  cy.intercept("POST", "/api/vault/deposit", {
    statusCode: 200,
    body: { result: "ok", txHash: "abc123" },
  }).as("deposit");

  cy.intercept("POST", "/api/vault/withdraw", {
    statusCode: 200,
    body: { result: "ok", txHash: "def456" },
  }).as("withdraw");

  cy.intercept("POST", "**/transactions/submit*", {
    statusCode: 200,
    body: { result: "ok" },
  }).as("txSubmit");
});

export {};
