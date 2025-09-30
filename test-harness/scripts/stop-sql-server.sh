#!/bin/bash
# Stop SQL Server test environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../sql-setup"

echo "========================================="
echo "Stopping SQL Server Test Environment"
echo "========================================="
echo ""

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
  echo "Using 'docker compose'..."
  DOCKER_COMPOSE="docker compose"
else
  DOCKER_COMPOSE="docker-compose"
fi

$DOCKER_COMPOSE down

echo ""
echo "✓ SQL Server test environment stopped"
echo ""
echo "To remove data volumes:"
echo "  cd sql-setup && $DOCKER_COMPOSE down -v"
echo ""