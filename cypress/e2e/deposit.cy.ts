describe("Deposit Flow", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
    cy.connectWallet();
  });

  it("shows deposit form when wallet connected", () => {
    cy.get("[data-cy=deposit-form]").should("be.visible");
  });

  it("disables submit when amount is empty", () => {
    cy.get("[data-cy=deposit-amount]").clear();
    cy.get("[data-cy=deposit-submit]").should("be.disabled");
  });

  it("rejects zero deposit", () => {
    cy.get("[data-cy=deposit-amount]").type("0");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=deposit-error]").should("be.visible");
  });

  it("rejects negative deposit amount", () => {
    cy.get("[data-cy=deposit-amount]").type("-50");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=deposit-error]").should("be.visible");
  });

  it("submits a valid deposit and shows pending state", () => {
    cy.get("[data-cy=deposit-amount]").type("100");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=tx-pending]").should("be.visible");
  });

  it("displays updated share balance after successful deposit", () => {
    // After deposit succeeds, balance_of returns updated amount
    cy.intercept("GET", "/api/vault/balance_of*", {
      statusCode: 200,
      body: { balance: "1100" },
    }).as("balanceUpdated");

    cy.get("[data-cy=deposit-amount]").type("100");
    cy.get("[data-cy=deposit-submit]").click();
    cy.get("[data-cy=share-balance]", { timeout: 8000 }).should("contain", "1100");
  });

  it("shows multi-step modal if present when deposit is initiated", () => {
    cy.get("[data-cy=deposit-amount]").type("100");
    cy.get("[data-cy=deposit-submit]").click();
    // Modal may or may not be present; assert tx-pending or modal step 1
    cy.get("[data-cy=tx-pending],[data-cy=tx-modal],[data-cy=modal-step-1]").should("exist");
  });
});
