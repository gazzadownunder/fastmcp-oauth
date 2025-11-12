/**
 * Example: MCP OAuth Server with Secure Secret Management
 *
 * This example demonstrates how to use the secret management system with the MCP OAuth framework.
 *
 * Setup:
 * 1. Copy examples/.env.example to .env in project root
 * 2. Fill in actual secret values in .env (never commit!)
 * 3. Use examples/secure-multi-module-config.json as your config file
 * 4. Run: npm start
 *
 * Production Deployment:
 * - Kubernetes: Mount secrets as files in /run/secrets/
 * - Docker: Use Docker secrets with docker-compose.yml
 * - Cloud: Use cloud provider secret managers (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager)
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import 'dotenv/config'; // IMPORTANT: Load .env first (must be first import)
import { ConfigManager } from '../src/config/manager.js';
import { AuditService } from '../src/core/audit-service.js';

async function main() {
  console.log('🔐 Starting MCP OAuth Server with Secure Secret Management\n');

  // Optional: Create audit service to track secret access
  const auditService = new AuditService({
    enabled: true,
    logAllAttempts: true,
  });

  // Create ConfigManager with secret resolution support
  const configManager = new ConfigManager({
    auditService,
    secretsDir: process.env.SECRETS_DIR || '/run/secrets',
  });

  try {
    // Load configuration - secrets will be resolved automatically
    const configPath = './examples/secure-multi-module-config.json';
    console.log(`📄 Loading configuration from: ${configPath}\n`);

    await configManager.loadConfig(configPath);

    console.log('✅ Configuration loaded successfully!');
    console.log('✅ All secrets resolved from secure sources\n');

    // Verify configuration (without logging sensitive data)
    const config = configManager.getConfig();
    console.log('📊 Configuration Summary:');
    console.log(`   - Server Name: ${config.mcp?.serverName || 'N/A'}`);
    console.log(`   - Delegation Modules: ${Object.keys(config.delegation?.modules || {}).length}`);
    console.log(
      `   - Module Names: ${Object.keys(config.delegation?.modules || {}).join(', ')}`
    );
    console.log(`   - Trusted IDPs: ${config.auth.trustedIDPs.length}`);

    // Example: Access resolved secrets (for debugging only - never log in production!)
    if (process.env.NODE_ENV === 'development') {
      const hrModule = config.delegation?.modules?.['hr-database'] as any;
      if (hrModule?.password) {
        console.log(
          `\n🔍 Debug (dev only): HR DB password length: ${hrModule.password.length} characters`
        );
      }
    }

    console.log('\n✅ Server ready to start!');
    console.log('   Next steps:');
    console.log('   1. Initialize CoreContext with this config');
    console.log('   2. Start FastMCP server with http-stream transport');
    console.log('   3. Tools will auto-register from delegation modules');

    // In real implementation, you would start the server here:
    // const server = new FastMCPOAuthServer(configManager);
    // await server.start({ transport: 'httpStream', port: 3000 });
  } catch (error) {
    console.error('\n❌ FATAL ERROR: Failed to load configuration');

    if (error instanceof Error) {
      console.error(`   Error: ${error.message}\n`);

      // Provide helpful hints for common errors
      if (error.message.includes('could not be resolved')) {
        console.error('💡 Troubleshooting:');
        console.error('   1. Check that .env file exists in project root');
        console.error('   2. Verify all required secrets are defined in .env');
        console.error('   3. For production, ensure /run/secrets/ contains secret files');
        console.error('   4. Run: ls -la /run/secrets/ (Linux/Mac) or dir /run/secrets/ (Windows)\n');

        console.error('   Required secrets:');
        console.error('   - HR_DB_PASSWORD');
        console.error('   - HR_OAUTH_CLIENT_SECRET');
        console.error('   - SALES_DB_PASSWORD');
        console.error('   - SALES_OAUTH_CLIENT_SECRET');
        console.error('   - ANALYTICS_DB_PASSWORD\n');
      }
    }

    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
