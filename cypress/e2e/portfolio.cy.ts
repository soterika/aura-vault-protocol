describe("Portfolio View", () => {
  beforeEach(() => {
    cy.interceptVaultApis();
    cy.visit("/");
    cy.connectWallet();
  });

  it("displays total vault assets", () => {
    cy.wait("@totalAssets");
    cy.get("[data-cy=total-assets]").should("be.visible").and("not.be.empty");
  });

  it("displays user share balance", () => {
    cy.wait("@balanceOf");
    cy.get("[data-cy=share-balance]").should("be.visible").and("not.be.empty");
  });

  it("displays price per share", () => {
    cy.get("[data-cy=price-per-share]").should("be.visible").and("not.be.empty");
  });

  it("shows portfolio section only when wallet is connected", () => {
    cy.get("[data-cy=portfolio-section]").should("be.visible");
    cy.disconnectWallet();
    cy.get("[data-cy=portfolio-section]").should("not.exist");
  });

  it("refreshes data when refresh button is clicked", () => {
    cy.wait("@totalAssets");
    cy.get("[data-cy=refresh-btn]").click();
    cy.wait("@totalAssets");
    cy.get("[data-cy=total-assets]").should("be.visible");
  });

  it("shows updated total assets after refresh with new data", () => {
    cy.wait("@totalAssets");

    cy.intercept("GET", "/api/vault/total_assets", {
      statusCode: 200,
      body: { total: "750000" },
    }).as("totalAssetsRefreshed");

    cy.get("[data-cy=refresh-btn]").click();
    cy.wait("@totalAssetsRefreshed");
    cy.get("[data-cy=total-assets]").should("contain", "750000");
  });
});
