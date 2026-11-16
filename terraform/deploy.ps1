# Aura Vault Protocol - AWS Infrastructure Deployment Script (PowerShell)
# This script automates the deployment of the Terraform infrastructure

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("deploy", "destroy", "plan", "init")]
    [string]$Action = "deploy"
)

# Function to print colored output
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write.Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Check if required tools are installed
function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    
    try {
        $awsVersion = aws --version 2>&1
        Write-Info "AWS CLI found: $awsVersion"
    }
    catch {
        Write-Error "AWS CLI is not installed. Please install it first."
        exit 1
    }
    
    try {
        $tfVersion = terraform --version
        Write-Info "Terraform found: $tfVersion"
    }
    catch {
        Write-Error "Terraform is not installed. Please install it first."
        exit 1
    }
    
    Write-Info "Prerequisites check passed."
}

# Check AWS credentials
function Test-AwsCredentials {
    Write-Info "Checking AWS credentials..."
    
    try {
        $identity = aws sts get-caller-identity 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "AWS credentials are configured."
        }
        else {
            Write-Error "AWS credentials are not configured. Please run 'aws configure'."
            exit 1
        }
    }
    catch {
        Write-Error "Failed to check AWS credentials: $_"
        exit 1
    }
}

# Create S3 backend if it doesn't exist
function Initialize-Backend {
    Write-Info "Checking S3 backend..."
    
    $BUCKET_NAME = "aura-vault-terraform-state"
    $TABLE_NAME = "aura-vault-terraform-locks"
    
    try {
        $bucketExists = aws s3api head-bucket --bucket $BUCKET_NAME 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "S3 bucket already exists."
        }
        else {
            Write-Warning "S3 bucket does not exist. Creating..."
            aws s3api create-bucket --bucket $BUCKET_NAME --region us-east-1
            aws s3api put-bucket-versioning --bucket $BUCKET_NAME --versioning-configuration Status=Enabled
            aws s3api put-bucket-encryption --bucket $BUCKET_NAME --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
            Write-Info "S3 bucket created."
        }
    }
    catch {
        Write-Error "Failed to create S3 bucket: $_"
        exit 1
    }
    
    try {
        $tableExists = aws dynamodb describe-table --table-name $TABLE_NAME 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "DynamoDB table already exists."
        }
        else {
            Write-Warning "DynamoDB table does not exist. Creating..."
            aws dynamodb create-table `
                --table-name $TABLE_NAME `
                --attribute-definitions AttributeName=LockID,AttributeType=S `
                --key-schema AttributeName=LockID,KeyType=HASH `
                --billing-mode PAY_PER_REQUEST `
                --region us-east-1
            Write-Info "DynamoDB table created."
        }
    }
    catch {
        Write-Error "Failed to create DynamoDB table: $_"
        exit 1
    }
}

# Package Lambda function
function Package-Lambda {
    Write-Info "Packaging Lambda function..."
    
    # Note: Lambda packaging requires Python and pip
    # This is a placeholder - you may need to adjust based on your environment
    Write-Warning "Lambda packaging requires Python environment. Please package manually if needed."
}

# Initialize Terraform
function Initialize-Terraform {
    Write-Info "Initializing Terraform..."
    terraform init
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Terraform initialized."
    }
    else {
        Write-Error "Terraform initialization failed."
        exit 1
    }
}

# Validate Terraform configuration
function Validate-Terraform {
    Write-Info "Validating Terraform configuration..."
    terraform validate
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Terraform configuration is valid."
    }
    else {
        Write-Error "Terraform validation failed."
        exit 1
    }
}

# Format Terraform files
function Format-Terraform {
    Write-Info "Formatting Terraform files..."
    terraform fmt -recursive
    Write-Info "Terraform files formatted."
}

# Plan Terraform deployment
function Plan-Terraform {
    Write-Info "Planning Terraform deployment..."
    terraform plan -out=tfplan
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Terraform plan created."
    }
    else {
        Write-Error "Terraform plan failed."
        exit 1
    }
}

# Apply Terraform deployment
function Apply-Terraform {
    Write-Info "Applying Terraform deployment..."
    terraform apply tfplan
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Terraform deployment completed."
    }
    else {
        Write-Error "Terraform deployment failed."
        exit 1
    }
}

# Show outputs
function Show-Outputs {
    Write-Info "Infrastructure outputs:"
    terraform output -json
}

# Main deployment function
function Deploy {
    Write-Info "Starting Aura Vault Protocol infrastructure deployment..."
    Write-Host ""
    
    Test-Prerequisites
    Test-AwsCredentials
    Initialize-Backend
    Package-Lambda
    Initialize-Terraform
    Validate-Terraform
    Format-Terraform
    Plan-Terraform
    
    Write-Host ""
    Write-Warning "Please review the Terraform plan above."
    $confirm = Read-Host "Do you want to proceed with the deployment? (yes/no)"
    
    if ($confirm -eq "yes") {
        Apply-Terraform
        Show-Outputs
        Write-Info "Deployment completed successfully!"
    }
    else {
        Write-Warning "Deployment cancelled by user."
        exit 0
    }
}

# Destroy infrastructure
function Destroy {
    Write-Warning "This will destroy all infrastructure. Are you sure?"
    $confirm = Read-Host "Type 'destroy' to confirm"
    
    if ($confirm -eq "destroy") {
        Write-Info "Destroying infrastructure..."
        terraform destroy
        Write-Info "Infrastructure destroyed."
    }
    else {
        Write-Warning "Destruction cancelled by user."
        exit 0
    }
}

# Execute based on action
switch ($Action) {
    "deploy" {
        Deploy
    }
    "destroy" {
        Destroy
    }
    "plan" {
        Test-Prerequisites
        Test-AwsCredentials
        Initialize-Terraform
        Plan-Terraform
    }
    "init" {
        Test-Prerequisites
        Test-AwsCredentials
        Initialize-Backend
        Initialize-Terraform
    }
    default {
        Write-Host "Usage: .\deploy.ps1 -Action {deploy|destroy|plan|init}"
        Write-Host "  deploy  - Deploy the infrastructure (default)"
        Write-Host "  destroy - Destroy the infrastructure"
        Write-Host "  plan    - Create a Terraform plan"
        Write-Host "  init    - Initialize Terraform and create backend"
        exit 1
    }
}
