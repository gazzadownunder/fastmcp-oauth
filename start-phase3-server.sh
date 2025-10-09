#!/bin/bash
cd "$(dirname "$0")"
export NODE_ENV=development
export CONFIG_PATH=./test-harness/config/phase3-test-config.json
export SERVER_PORT=3000
node dist/test-harness/v2-test-server.js
