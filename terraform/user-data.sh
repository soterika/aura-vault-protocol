#!/bin/bash
set -e

# Update system
yum update -y

# Install Docker
yum install -y docker
systemctl start docker
systemctl enable docker

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# Install git
yum install -y git

# Create application directory
mkdir -p /opt/aura-vault
cd /opt/aura-vault

# Clone repository (replace with your actual repo URL)
# git clone https://github.com/your-org/aura-vault-protocol.git .

# Set environment variables
cat > /opt/aura-vault/.env << EOF
NODE_ENV=${environment}
PROJECT_NAME=${project_name}
DB_ENDPOINT=${db_endpoint}
DB_NAME=${db_name}
DB_USERNAME=${db_username}
DB_SECRET_ID=${db_secret_id}
SECRETS_PROVIDER=aws
APP_SECRETS_ID=${app_secret_id}
AWS_REGION=${aws_region}
EOF

# Pull and run Docker containers
# docker-compose pull
# docker-compose up -d

# Create health check endpoint
mkdir -p /opt/aura-vault/health
cat > /opt/aura-vault/health/index.js << 'EOF'
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
server.listen(3000, () => {
  console.log('Health check server running on port 3000');
});
EOF

# Start health check service
cd /opt/aura-vault/health
nohup node index.js > /var/log/health-check.log 2>&1 &

# Configure CloudWatch logs
yum install -y amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:///opt/aura-vault/cloudwatch-config.json

echo "Instance initialization complete"
