/**
 * Staging environment — root module
 *
 * Provisions the staging RDS read replica using the shared rds-replica module.
 * The primary RDS instance is created by the root terraform/ configuration;
 * this environment config wires the module onto it.
 *
 * Run from this directory:
 *   terraform init
 *   terraform plan -var-file="staging.tfvars"
 *   terraform apply -var-file="staging.tfvars"
 */

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }

  # Remote state — update bucket/key to match your Terraform backend config
  backend "s3" {
    bucket         = "aura-vault-terraform-state"
    key            = "envs/staging/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "aura-vault-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "aura-vault-protocol"
      Environment = "staging"
      Component   = "database"
      ManagedBy   = "terraform"
      CostCenter  = "platform"
    }
  }
}

# ---------------------------------------------------------------------------
# Data sources — reference the primary RDS instance from root state
# ---------------------------------------------------------------------------
data "terraform_remote_state" "root" {
  backend = "s3"
  config = {
    bucket = "aura-vault-terraform-state"
    key    = "infrastructure/terraform.tfstate"
    region = "us-east-1"
  }
}

# ---------------------------------------------------------------------------
# RDS Read Replica — Staging
# ---------------------------------------------------------------------------
module "rds_replica" {
  source = "../../modules/rds-replica"

  primary_instance_id = "aura-vault-db-staging"
  instance_class      = var.replica_instance_class
  availability_zone   = var.replica_availability_zone
  environment         = "staging"

  # Inherit monitoring role from root infrastructure
  monitoring_role_arn          = data.terraform_remote_state.root.outputs.rds_monitoring_role_arn
  performance_insights_enabled = true

  extra_tags = {
    CostCenter = "platform"
    AutoShutdown = "true"   # staging replicas can be stopped overnight
  }
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "replica_endpoint" {
  description = "Staging read-replica endpoint (host:port) — wire into DATABASE_REPLICA_URL."
  value       = module.rds_replica.replica_endpoint
  sensitive   = true
}

output "replica_arn" {
  description = "ARN of the staging read replica."
  value       = module.rds_replica.replica_arn
}
