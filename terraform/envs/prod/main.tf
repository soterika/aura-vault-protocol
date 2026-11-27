/**
 * Production environment — root module
 *
 * Provisions production infrastructure including the ElastiCache Redis 7 cluster.
 *
 * Run from this directory:
 *   terraform init
 *   terraform plan -var-file="prod.tfvars"
 *   terraform apply -var-file="prod.tfvars"
 */

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }

  backend "s3" {
    bucket         = "aura-vault-terraform-state"
    key            = "envs/prod/terraform.tfstate"
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
      Environment = "prod"
      Component   = "cache"
      ManagedBy   = "terraform"
      CostCenter  = "platform"
    }
  }
}

# ---------------------------------------------------------------------------
# Data sources — reference shared infrastructure from root state
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
# ElastiCache Redis 7 Cluster — Production
# ---------------------------------------------------------------------------
module "elasticache" {
  source = "../../modules/elasticache"

  cluster_name               = "aura-vault-redis-prod"
  node_type                  = var.redis_node_type
  num_shards                 = var.redis_num_shards
  environment                = "prod"
  vpc_id                     = data.terraform_remote_state.root.outputs.vpc_id
  subnet_ids                 = data.terraform_remote_state.root.outputs.private_subnet_ids
  allowed_security_group_ids = [data.terraform_remote_state.root.outputs.backend_security_group_id]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "redis_cluster_endpoint" {
  description = "Production ElastiCache Redis cluster configuration endpoint."
  value       = module.elasticache.cluster_endpoint
}

output "redis_reader_endpoint" {
  description = "Production ElastiCache Redis cluster reader endpoint."
  value       = module.elasticache.reader_endpoint
}

output "redis_port" {
  description = "Production ElastiCache Redis cluster port."
  value       = module.elasticache.port
}
