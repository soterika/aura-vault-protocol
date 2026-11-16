describe("Withdrawal Flow", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
    cy.connectWallet();
  });

  it("shows withdrawal form when wallet connected", () => {
    cy.get("[data-cy=withdraw-form]").should("be.visible");
  });

  it("disables submit when shares field is empty", () => {
    cy.get("[data-cy=withdraw-shares]").clear();
    cy.get("[data-cy=withdraw-submit]").should("be.disabled");
  });

  it("rejects zero shares withdrawal", () => {
    cy.get("[data-cy=withdraw-shares]").type("0");
    cy.get("[data-cy=withdraw-submit]").click();
    cy.get("[data-cy=withdraw-error]").should("be.visible");
  });

  it("rejects withdrawal exceeding balance", () => {
    cy.get("[data-cy=withdraw-shares]").type("99999");
    cy.get("[data-cy=withdraw-submit]").click();
    cy.get("[data-cy=withdraw-error]").should("contain.text", "Insufficient");
  });

  it("submits valid withdrawal and shows pending state", () => {
    cy.get("[data-cy=withdraw-shares]").type("50");
    cy.get("[data-cy=withdraw-submit]").click();
    cy.get("[data-cy=tx-pending]").should("be.visible");
  });

  it("shows updated balance after successful withdrawal", () => {
    cy.intercept("GET", "/api/vault/balance_of*", {
      statusCode: 200,
      body: { balance: "950" },
    }).as("balanceUpdated");

    cy.get("[data-cy=withdraw-shares]").type("50");
    cy.get("[data-cy=withdraw-submit]").click();
    cy.get("[data-cy=share-balance]", { timeout: 8000 }).should("contain", "950");
  });
});
