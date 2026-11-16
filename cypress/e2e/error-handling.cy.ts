describe("Error Handling", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
    cy.connectWallet();
  });

  it("shows error toast when deposit transaction fails", () => {
    cy.intercept("POST", "/api/vault/deposit", { statusCode: 500, body: { error: "Transaction failed" } }).as("depositFail");
    cy.intercept("POST", "**/transactions/submit*", { statusCode: 500, body: { error: "Transaction failed" } }).as("txFail");
    cy.get("[data-cy=deposit-amount]").type("100");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=error-toast]", { timeout: 8000 }).should("be.visible");
  });

  it("shows error toast when withdrawal transaction fails", () => {
    cy.intercept("POST", "/api/vault/withdraw", { statusCode: 500, body: { error: "InsufficientShares" } }).as("withdrawFail");
    cy.intercept("POST", "**/transactions/submit*", { statusCode: 500, body: { error: "InsufficientShares" } }).as("txFail");
    cy.get("[data-cy=withdraw-shares]").type("10");
    cy.get("[data-cy=withdraw-submit]").click();
    cy.get("[data-cy=error-toast]", { timeout: 8000 }).should("be.visible");
  });

  it("shows fallback UI when vault data fetch fails", () => {
    cy.intercept("GET", "/api/vault/total_assets", { statusCode: 503 }).as("assetsFail");
    cy.intercept("GET", "/api/vault/balance_of*", { statusCode: 503 }).as("balanceFail");
    cy.get("[data-cy=refresh-btn]").click();
    cy.get("[data-cy=data-error],[data-cy=total-assets]").should("exist");
  });

  it("handles wallet not installed gracefully", () => {
    cy.disconnectWallet();
    cy.window().then((win) => {
      delete (win as any).freighterApi;
    });
    cy.get("[data-cy=connect-wallet-btn]").click();
    cy.get("[data-cy=wallet-error]", { timeout: 8000 }).should("be.visible");
  });

  it("dismisses error toast when close button is clicked", () => {
    cy.intercept("POST", "/api/vault/deposit", { statusCode: 500 }).as("depositFail");
    cy.intercept("POST", "**/transactions/submit*", { statusCode: 500 }).as("txFail");
    cy.get("[data-cy=deposit-amount]").type("100");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=error-toast]", { timeout: 8000 }).should("be.visible");
    cy.get("[data-cy=toast-close]").click();
    cy.get("[data-cy=error-toast]").should("not.exist");
  });
});
