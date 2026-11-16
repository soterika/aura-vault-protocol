import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    specPattern: "cypress/e2e/**/*.cy.{ts,tsx}",
    screenshotOnRunFailure: true,
    video: false,
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    supportFile: "cypress/support/e2e.ts",
    setupNodeEvents(on) {
      // Task: log accessibility violations to the Cypress command log and CI output
      on("task", {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
    },
  },
});
