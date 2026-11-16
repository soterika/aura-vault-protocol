#!/bin/bash

# Aura Vault Protocol - AWS Infrastructure Deployment Script
# This script automates the deployment of the Terraform infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v terraform &> /dev/null; then
        print_error "Terraform is not installed. Please install it first."
        exit 1
    fi
    
    print_info "Prerequisites check passed."
}

# Check AWS credentials
check_aws_credentials() {
    print_info "Checking AWS credentials..."
    
    if aws sts get-caller-identity &> /dev/null; then
        print_info "AWS credentials are configured."
    else
        print_error "AWS credentials are not configured. Please run 'aws configure'."
        exit 1
    fi
}

# Create S3 backend if it doesn't exist
create_backend() {
    print_info "Checking S3 backend..."
    
    BUCKET_NAME="aura-vault-terraform-state"
    TABLE_NAME="aura-vault-terraform-locks"
    
    if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
        print_info "S3 bucket already exists."
    else
        print_warning "S3 bucket does not exist. Creating..."
        aws s3api create-bucket --bucket "$BUCKET_NAME" --region us-east-1
        aws s3api put-bucket-versioning --bucket "$BUCKET_NAME" --versioning-configuration Status=Enabled
        aws s3api put-bucket-encryption --bucket "$BUCKET_NAME" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
        print_info "S3 bucket created."
    fi
    
    if aws dynamodb describe-table --table-name "$TABLE_NAME" &> /dev/null; then
        print_info "DynamoDB table already exists."
    else
        print_warning "DynamoDB table does not exist. Creating..."
        aws dynamodb create-table \
            --table-name "$TABLE_NAME" \
            --attribute-definitions AttributeName=LockID,AttributeType=S \
            --key-schema AttributeName=LockID,KeyType=HASH \
            --billing-mode PAY_PER_REQUEST \
            --region us-east-1
        print_info "DynamoDB table created."
    fi
}

# Package Lambda function
package_lambda() {
    print_info "Packaging Lambda function..."
    
    cd lambda
    
    # Create virtual environment
    python3 -m venv venv
    source venv/bin/activate
    
    # Install dependencies
    pip install -r requirements.txt -t .
    
    # Create deployment package
    zip -r backup.zip backup.py *.pyc boto3* botocore* urllib3* 2>/dev/null || true
    zip -r backup.zip backup.py
    
    deactivate
    
    cd ..
    
    print_info "Lambda function packaged."
}

# Initialize Terraform
init_terraform() {
    print_info "Initializing Terraform..."
    terraform init
    print_info "Terraform initialized."
}

# Validate Terraform configuration
validate_terraform() {
    print_info "Validating Terraform configuration..."
    terraform validate
    print_info "Terraform configuration is valid."
}

# Format Terraform files
format_terraform() {
    print_info "Formatting Terraform files..."
    terraform fmt -recursive
    print_info "Terraform files formatted."
}

# Plan Terraform deployment
plan_terraform() {
    print_info "Planning Terraform deployment..."
    terraform plan -out=tfplan
    print_info "Terraform plan created."
}

# Apply Terraform deployment
apply_terraform() {
    print_info "Applying Terraform deployment..."
    terraform apply tfplan
    print_info "Terraform deployment completed."
}

# Show outputs
show_outputs() {
    print_info "Infrastructure outputs:"
    terraform output -json
}

# Main deployment function
deploy() {
    print_info "Starting Aura Vault Protocol infrastructure deployment..."
    echo ""
    
    check_prerequisites
    check_aws_credentials
    create_backend
    package_lambda
    init_terraform
    validate_terraform
    format_terraform
    plan_terraform
    
    echo ""
    print_warning "Please review the Terraform plan above."
    read -p "Do you want to proceed with the deployment? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        apply_terraform
        show_outputs
        print_info "Deployment completed successfully!"
    else
        print_warning "Deployment cancelled by user."
        exit 0
    fi
}

# Destroy infrastructure
destroy() {
    print_warning "This will destroy all infrastructure. Are you sure?"
    read -p "Type 'destroy' to confirm: " confirm
    
    if [ "$confirm" = "destroy" ]; then
        print_info "Destroying infrastructure..."
        terraform destroy
        print_info "Infrastructure destroyed."
    else
        print_warning "Destruction cancelled by user."
        exit 0
    fi
}

# Parse command line arguments
case "${1:-deploy}" in
    deploy)
        deploy
        ;;
    destroy)
        destroy
        ;;
    plan)
        check_prerequisites
        check_aws_credentials
        init_terraform
        plan_terraform
        ;;
    init)
        check_prerequisites
        check_aws_credentials
        create_backend
        init_terraform
        ;;
    *)
        echo "Usage: $0 {deploy|destroy|plan|init}"
        echo "  deploy  - Deploy the infrastructure (default)"
        echo "  destroy - Destroy the infrastructure"
        echo "  plan    - Create a Terraform plan"
        echo "  init    - Initialize Terraform and create backend"
        exit 1
        ;;
esac
