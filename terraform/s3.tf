# S3 Bucket for ALB Logs (already defined in cloudwatch.tf, this is for reference)
# Additional S3 buckets can be added here as needed

# S3 Bucket for Terraform State (pre-created)
# This bucket should be created manually before running terraform
# terraform {
#   backend "s3" {
#     bucket         = "aura-vault-terraform-state"
#     key            = "infrastructure/terraform.tfstate"
#     region         = "us-east-1"
#     encrypt        = true
#     dynamodb_table = "aura-vault-terraform-locks"
#   }
# }

# DynamoDB Table for Terraform State Locking
resource "aws_dynamodb_table" "terraform_locks" {
  name           = "aura-vault-terraform-locks"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "LockID"
  
  attribute {
    name = "LockID"
    type = "S"
  }
  
  tags = {
    Name = "aura-vault-terraform-locks"
  }
  
  # This table should be created before running terraform
  # Commented out to avoid circular dependency with backend configuration
  lifecycle {
    ignore_changes = all
  }
}
