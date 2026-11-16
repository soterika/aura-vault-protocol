locals {
  cost_environment = var.environment == "prod" ? "production" : var.environment == "dev" ? "development" : var.environment
}
