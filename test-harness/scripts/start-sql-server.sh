#!/bin/bash
# Start SQL Server test environment using Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "========================================="
echo "Starting SQL Server Test Environment"
echo "========================================="
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo "✗ Docker is not installed or not in PATH"
  echo "Please install Docker to use the test SQL Server"
  exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
  echo "⚠ docker-compose not found, trying 'docker compose'..."
  DOCKER_COMPOSE="docker compose"
else
  DOCKER_COMPOSE="docker-compose"
fi

# Start SQL Server container
echo "Starting SQL Server 2022 container..."
cd sql-setup
$DOCKER_COMPOSE up -d

echo ""
echo "Waiting for SQL Server to be ready..."
sleep 10

# Wait for SQL Server to accept connections
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if docker exec test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -Q "SELECT 1" > /dev/null 2>&1; then
    echo "✓ SQL Server is ready!"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  echo "  Waiting... (attempt $ATTEMPT/$MAX_ATTEMPTS)"
  sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "✗ SQL Server failed to start within timeout"
  exit 1
fi

# Initialize database
echo ""
echo "Initializing test database..."
docker exec -i test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C < init-test-db.sql
echo "✓ Test database created"

echo ""
echo "Creating test users..."
docker exec -i test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -d test_legacy_app < create-test-users.sql
echo "✓ Test users created"

echo ""
echo "Seeding test data..."
docker exec -i test-sql-server /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "YourStrong@Passw0rd" -C -d test_legacy_app < sample-data.sql
echo "✓ Test data seeded"

echo ""
echo "========================================="
echo "SQL Server Test Environment Ready"
echo "========================================="
echo "Server: localhost:1433"
echo "Database: test_legacy_app"
echo "SA Password: YourStrong@Passw0rd"
echo ""
echo "Test users configured for EXECUTE AS:"
echo "  - [TESTDOMAIN\\testuser]"
echo "  - [TESTDOMAIN\\adminuser]"
echo ""
echo "To stop:"
echo "  ./scripts/stop-sql-server.sh"
echo ""