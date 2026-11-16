terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  
  backend "s3" {
    bucket         = "aura-vault-terraform-state"
    key            = "infrastructure/terraform.tfstate"
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
      Environment = local.cost_environment
      Component   = var.default_component
      ManagedBy   = "terraform"
      CostCenter  = var.cost_center
    }
  }
}

# Provider alias for S3 cross-region replication destination (us-west-2)
# Used by terraform/s3-backup.tf for the replica bucket — Issue #961
provider "aws" {
  alias  = "replica"
  region = "us-west-2"

  default_tags {
    tags = {
      Project     = "aura-vault-protocol"
      Environment = local.cost_environment
      Component   = var.default_component
      ManagedBy   = "terraform"
      CostCenter  = var.cost_center
    }
  }
}
