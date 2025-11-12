#!/usr/bin/env node

import { FastMCPOAuthServer } from '../index.js';
import { configManager } from '../config/manager.js';

async function main() {
  // Load configuration from environment or default path
  const configPath = process.env.CONFIG_PATH || './config/oauth-obo.json';

  const server = new FastMCPOAuthServer(configPath);

  try {
    console.log('Starting FastMCP OAuth OBO Server...');
    console.log(`Configuration: ${configPath}`);
    console.log(`Environment: ${configManager.getEnvironment().NODE_ENV}`);

    // Start server with HTTP streaming transport
    await server.start({
      transport: 'http-stream',
      port: parseInt(process.env.PORT || '3000'),
      configPath,
    });

    console.log(`Server running on port ${configManager.getServerPort()}`);

    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      console.log('\\nReceived SIGINT, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\\nReceived SIGTERM, shutting down gracefully...');
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
