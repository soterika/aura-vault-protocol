/**
 * Cypress E2E support file — Issue #986
 *
 * Configures cypress-axe for WCAG 2.1 AA accessibility audits on all pages
 * tested in the E2E suite.  cy.injectAxe() must be called after cy.visit()
 * in each test, and cy.checkA11y() runs the axe-core audit.
 */

// Import the existing custom commands
import "./commands";

// Import cypress-axe to register cy.injectAxe() and cy.checkA11y()
import "cypress-axe";
