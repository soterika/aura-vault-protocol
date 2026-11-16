/**
 * Production environment — root module
 *
 * Provisions the production RDS read replica using the shared rds-replica module.
 *
 * Run from this directory:
 *   terraform init
 *   terraform plan -var-file="production.tfvars"
 *   terraform apply -var-file="production.tfvars"
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
    key            = "envs/production/terraform.tfstate"
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
      Environment = "production"
      Component   = "database"
      ManagedBy   = "terraform"
      CostCenter  = "platform"
    }
  }
}

provider "aws" {
  alias  = "dr"
  region = var.aws_region
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
# RDS Read Replica — Production
# ---------------------------------------------------------------------------
module "rds_replica" {
  source = "../../modules/rds-replica"
  providers = {
    aws = aws.dr
  }

  primary_instance_id = "aura-vault-db-prod"
  primary_instance_arn = data.terraform_remote_state.root.outputs.rds_instance_arn
  primary_instance_class = "db.r6g.large"
  instance_class      = var.replica_instance_class
  availability_zone   = var.replica_availability_zone
  environment         = "prod"
  kms_key_id          = aws_kms_key.dr_replica.arn

  monitoring_role_arn          = data.terraform_remote_state.root.outputs.rds_monitoring_role_arn
  performance_insights_enabled = true

  extra_tags = {
    CostCenter     = "platform"
    Criticality    = "high"
    BackupPolicy   = "managed-by-primary"
  }
}

resource "aws_kms_key" "dr_replica" {
  provider                = aws.dr
  description             = "Encryption key for the Aura Vault production RDS DR replica in eu-west-1"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = {
    Name        = "aura-vault-prod-dr-rds"
    Environment = "production"
    Role        = "disaster-recovery"
  }
}

resource "aws_kms_alias" "dr_replica" {
  provider      = aws.dr
  name          = "alias/aura-vault-prod-dr-rds"
  target_key_id = aws_kms_key.dr_replica.key_id
}

resource "aws_sns_topic" "dr_alerts" {
  provider = aws.dr
  name     = "aura-vault-prod-dr-alerts"

  kms_master_key_id = aws_kms_key.dr_replica.arn
}

resource "aws_sns_topic_subscription" "pagerduty" {
  count     = var.pagerduty_integration_key != "" ? 1 : 0
  provider  = aws.dr
  topic_arn = aws_sns_topic.dr_alerts.arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/${var.pagerduty_integration_key}/enqueue"
}

resource "aws_cloudwatch_metric_alarm" "replica_lag" {
  provider            = aws.dr
  alarm_name          = "aura-vault-prod-dr-replica-lag"
  alarm_description   = "Production RDS DR replica lag exceeded five minutes in eu-west-1."
  namespace           = "AWS/RDS"
  metric_name         = "ReplicaLag"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = module.rds_replica.replica_identifier
  }

  alarm_actions = [aws_sns_topic.dr_alerts.arn]
  ok_actions    = [aws_sns_topic.dr_alerts.arn]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "replica_endpoint" {
  description = "Production read-replica endpoint (host:port) — wire into DATABASE_REPLICA_URL."
  value       = module.rds_replica.replica_endpoint
  sensitive   = true
}

output "replica_arn" {
  description = "ARN of the production read replica."
  value       = module.rds_replica.replica_arn
}

output "replica_lag_alarm_arn" {
  description = "CloudWatch alarm ARN for the cross-region production replica lag."
  value       = aws_cloudwatch_metric_alarm.replica_lag.arn
}

output "replica_alert_topic_arn" {
  description = "SNS topic receiving cross-region replica-lag alarms."
  value       = aws_sns_topic.dr_alerts.arn
}
