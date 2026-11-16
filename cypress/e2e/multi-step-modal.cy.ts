/**
 * Multi-step deposit/withdrawal modal tests.
 * Steps: amount input (modal-step-1) → review (modal-step-2) → confirmation (modal-step-3)
 */
describe("Multi-Step Modal", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
    cy.connectWallet();
  });

  context("Deposit modal", () => {
    it("opens modal on deposit submit", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").should("be.visible");
    });

    it("shows step 1 (amount input) first", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-step-1]").should("be.visible");
      });
    });

    it("advances to step 2 (review) via next button", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-step-2]").should("be.visible");
      });
    });

    it("goes back to step 1 from step 2 via back button", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-step-2]").should("be.visible");
        cy.get("[data-cy=modal-back-btn]").click();
        cy.get("[data-cy=modal-step-1]").should("be.visible");
      });
    });

    it("advances to step 3 (confirmation) from step 2", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-step-2]").should("be.visible");
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-step-3]").should("be.visible");
      });
    });

    it("confirms deposit and shows success state", () => {
      cy.get("[data-cy=deposit-amount]").type("100");
      cy.get("[data-cy=deposit-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-confirm-btn]").click();
        cy.get("[data-cy=modal-success]", { timeout: 10000 }).should("be.visible");
      });
    });
  });

  context("Withdrawal modal", () => {
    it("opens modal on withdrawal submit", () => {
      cy.get("[data-cy=withdraw-shares]").type("50");
      cy.get("[data-cy=withdraw-submit]").click();
      cy.get("[data-cy=tx-modal]").should("be.visible");
    });

    it("shows step 1 (amount input) first", () => {
      cy.get("[data-cy=withdraw-shares]").type("50");
      cy.get("[data-cy=withdraw-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-step-1]").should("be.visible");
      });
    });

    it("confirms withdrawal and shows success state", () => {
      cy.get("[data-cy=withdraw-shares]").type("50");
      cy.get("[data-cy=withdraw-submit]").click();
      cy.get("[data-cy=tx-modal]").within(() => {
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-next-btn]").click();
        cy.get("[data-cy=modal-confirm-btn]").click();
        cy.get("[data-cy=modal-success]", { timeout: 10000 }).should("be.visible");
      });
    });
  });
});
