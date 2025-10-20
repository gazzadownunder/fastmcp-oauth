#!/usr/bin/env node
/**
 * v2 Test Server - New Modular Framework with Multi-Delegation Support
 *
 * Purpose: Test harness for validating the new modular architecture (v2.0+)
 *
 * Features:
 * - Uses MCPOAuthServer wrapper (simplified API)
 * - Unified config format (auth + delegation + mcp)
 * - Multi-IDP support (requestor JWT + multiple TE-JWTs)
 * - Role-based authorization (no static permissions)
 * - All available tools registered (sql-delegate, health-check, user-info)
 * - Graceful shutdown handling
 *
 * Multi-Delegation Architecture:
 * - Supports multiple TrustedIDPs with same issuer, different audiences
 * - Example: requestor JWT (aud: "mcp-oauth") + SQL TE-JWT (aud: "urn:sql:database")
 * - JWT validation matches by issuer + audience
 * - Delegation-specific claims stored in session.customClaims
 *
 * Usage:
 *   npm run build
 *   node dist/test-harness/v2-test-server.js
 *
 * Environment:
 *   NODE_ENV=development
 *   CONFIG_PATH=./test-harness/config/phase3-test-config.json
 *   SERVER_PORT=3000
 */

import { MCPOAuthServer } from '../src/mcp/server.js';
import { PostgreSQLDelegationModule } from '../src/delegation/sql/postgresql-module.js';
import { KerberosDelegationModule } from '../src/delegation/kerberos/kerberos-module.js';
import { TokenExchangeService } from '../src/delegation/token-exchange.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - Set NODE_ENV FIRST for schema validation
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const CONFIG_PATH = process.env.CONFIG_PATH || './test-harness/config/v2-keycloak-oauth-only.json';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV;

console.log('═══════════════════════════════════════════════════════════');
console.log('  MCP OAuth v2 Test Server - New Modular Framework');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Environment:     ${NODE_ENV}`);
console.log(`Config:          ${CONFIG_PATH}`);
console.log(`Port:            ${SERVER_PORT}`);
console.log(`Transport:       http-stream`);
console.log('═══════════════════════════════════════════════════════════\n');

async function main() {
  let server: MCPOAuthServer | null = null;

  try {
    // Step 1: Create server with config path
    console.log('[1/3] Creating MCPOAuthServer...');
    const configPath = path.resolve(process.cwd(), CONFIG_PATH);
    console.log(`      Config path: ${configPath}`);

    server = new MCPOAuthServer(configPath);
    console.log('✓     Server instance created\n');

    // Step 2: Start server (this initializes CoreContext)
    console.log('[2/3] Starting MCP server...');
    console.log('      Loading config, building CoreContext, registering tools...');
    await server.start({
      transport: 'httpStream', // Fixed: use camelCase not kebab-case
      port: SERVER_PORT
    });
    console.log(`✓     Server started successfully\n`);

    // Display Multi-IDP Configuration
    const coreContext = server.getCoreContext();
    const authConfig = coreContext.configManager.getAuthConfig();

    if (authConfig?.trustedIDPs && authConfig.trustedIDPs.length > 1) {
      console.log('Multi-IDP Configuration Detected:');
      authConfig.trustedIDPs.forEach((idp, index) => {
        const name = idp.name || `IDP ${index + 1}`;
        console.log(`  ${index + 1}. ${name}`);
        console.log(`     Issuer:   ${idp.issuer}`);
        console.log(`     Audience: ${idp.audience}`);
      });
      console.log('');
      console.log('JWT Validation:');
      console.log('  • Matches by issuer + audience (supports same issuer, different audiences)');
      console.log('  • Example: requestor JWT (mcp-oauth) vs TE-JWT (urn:sql:database)');
      console.log('');
    }

    // Step 3: Register delegation modules (AFTER start, optional)
    console.log('[3/3] Checking for delegation modules...');

    const delegationConfig = coreContext.configManager.getDelegationConfig();

    if (delegationConfig?.modules?.postgresql) {
      console.log('      PostgreSQL delegation module detected in config');
      const pgModule = new PostgreSQLDelegationModule();

      // Initialize PostgreSQL module with connection config
      console.log('      Initializing PostgreSQL connection...');
      await pgModule.initialize(delegationConfig.modules.postgresql);
      console.log('✓     PostgreSQL connection initialized');

      // Check if token exchange is configured
      if (delegationConfig?.tokenExchange) {
        console.log('      Token exchange detected in config');
        console.log(`      Token endpoint: ${delegationConfig.tokenExchange.tokenEndpoint}`);
        console.log(`      Client ID: ${delegationConfig.tokenExchange.clientId}`);
        console.log(`      Audience: ${delegationConfig.tokenExchange.audience || 'default'}`);

        // Create TokenExchangeService
        const tokenExchangeService = new TokenExchangeService(
          delegationConfig.tokenExchange,
          coreContext.auditService
        );

        // Inject into PostgreSQL module
        pgModule.setTokenExchangeService(tokenExchangeService, {
          tokenEndpoint: delegationConfig.tokenExchange.tokenEndpoint,
          clientId: delegationConfig.tokenExchange.clientId,
          clientSecret: delegationConfig.tokenExchange.clientSecret,
          audience: delegationConfig.tokenExchange.audience,
        });

        console.log('✓     Token exchange service initialized');
      }

      await server.registerDelegationModule('postgresql', pgModule);
      console.log('✓     PostgreSQL delegation module registered\n');
    } else {
      console.log('      No PostgreSQL module configured\n');
    }

    // Check for Kerberos delegation module
    if (delegationConfig?.modules?.kerberos?.enabled) {
      console.log('      Kerberos delegation module detected in config');
      const kerberosModule = new KerberosDelegationModule();

      try {
        // Initialize Kerberos module
        console.log('      Initializing Kerberos connection to KDC...');
        console.log(`      Domain Controller: ${delegationConfig.modules.kerberos.domainController}`);
        console.log(`      Realm: ${delegationConfig.modules.kerberos.realm}`);
        console.log(`      Service Principal: ${delegationConfig.modules.kerberos.servicePrincipalName}`);

        await kerberosModule.initialize(delegationConfig.modules.kerberos);
        console.log('✓     Kerberos service ticket (TGT) obtained');

        // Check if token exchange is configured for Kerberos
        if (delegationConfig?.tokenExchange) {
          console.log('      Token exchange detected for Kerberos delegation');
          console.log(`      Token endpoint: ${delegationConfig.tokenExchange.tokenEndpoint}`);
          console.log(`      Client ID: ${delegationConfig.tokenExchange.clientId}`);
          console.log(`      Audience: ${delegationConfig.tokenExchange.audience || 'kerberos-delegation'}`);

          // Create TokenExchangeService (reuse same instance if PostgreSQL already created it)
          const tokenExchangeService = new TokenExchangeService(
            delegationConfig.tokenExchange,
            coreContext.auditService
          );

          // Inject into Kerberos module
          kerberosModule.setTokenExchangeService(tokenExchangeService, {
            tokenEndpoint: delegationConfig.tokenExchange.tokenEndpoint,
            clientId: delegationConfig.tokenExchange.clientId,
            clientSecret: delegationConfig.tokenExchange.clientSecret,
            audience: delegationConfig.tokenExchange.audience,
          });

          console.log('✓     Token exchange service configured for Kerberos');
        }

        // Display delegation configuration
        if (delegationConfig.modules.kerberos.allowedDelegationTargets?.length > 0) {
          console.log('      Allowed delegation targets:');
          delegationConfig.modules.kerberos.allowedDelegationTargets.forEach((target: string) => {
            console.log(`        - ${target}`);
          });
        }

        // Display cache configuration
        if (delegationConfig.modules.kerberos.ticketCache?.enabled) {
          console.log('      Ticket cache enabled:');
          console.log(`        TTL: ${delegationConfig.modules.kerberos.ticketCache.ttlSeconds}s`);
          console.log(`        Renewal threshold: ${delegationConfig.modules.kerberos.ticketCache.renewThresholdSeconds}s`);
        }

        await server.registerDelegationModule('kerberos', kerberosModule);
        console.log('✓     Kerberos delegation module registered\n');
      } catch (error) {
        console.error('✗     Kerberos initialization failed');
        console.error(`      Error: ${error instanceof Error ? error.message : String(error)}`);
        console.error('');
        console.error('      Common issues:');
        console.error('        • KDC (Active Directory) not reachable at configured address');
        console.error('        • Service account credentials invalid');
        console.error('        • Service account not configured for delegation (run setup-ad-kerberos.ps1)');
        console.error('        • Kerberos library not installed (npm install kerberos)');
        console.error('');
        console.error('      Continuing without Kerberos support...\n');
      }
    } else {
      console.log('      No Kerberos module configured (or disabled)\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Server Ready - Press Ctrl+C to stop');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Available Tools:');
    console.log('  • health-check      - Check delegation service health');
    console.log('  • user-info         - Get current user session info');
    if (delegationConfig?.modules?.postgresql) {
      console.log('  • sql-delegate      - Execute SQL queries with positional params ($1, $2, etc.)');
      console.log('  • sql-schema        - Get list of tables in database schema');
      console.log('  • sql-table-details - Get column details for a specific table');
    }
    if (delegationConfig?.modules?.kerberos?.enabled) {
      console.log('  • kerberos-delegate - Obtain Kerberos tickets (S4U2Self/S4U2Proxy)');
    }
    console.log('');

    console.log('Test Commands:');
    console.log('  1. Get requestor JWT from Keycloak (aud: mcp-oauth)');
    console.log('     - Used for MCP tool access authorization');
    console.log('     - Token must have "user" or "admin" role for sql-delegate tool');
    console.log('');
    console.log('  2. Call user-info tool (shows JWT details):');
    console.log('     curl -X POST http://localhost:3000/mcp \\');
    console.log('       -H "Authorization: Bearer $REQUESTOR_JWT" \\');
    console.log('       -d \'{"method":"tools/call","params":{"name":"user-info","arguments":{}}}\'');
    console.log('');

    if (delegationConfig?.tokenExchange) {
      console.log('  3. PostgreSQL delegation with token exchange:');
      console.log('     - Framework exchanges requestor JWT for TE-JWT (aud: urn:sql:database)');
      console.log('     - TE-JWT contains legacy_name for SET ROLE');
      console.log('     - PostgreSQL checks primary authorization (role permissions)');
      console.log('     - Test tables: alice_table (alice only), bob_table (bob only), general_table (both)');
      console.log('');
    }
    console.log('');

    // Keep the process alive (FastMCP doesn't block on httpStream transport)
    // This prevents the server from exiting immediately
    await new Promise(() => {}); // Never resolves - keeps process alive until SIGINT/SIGTERM

  } catch (error) {
    console.error('\n❌ Server startup failed:\n');

    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);

      if (error.stack && NODE_ENV === 'development') {
        console.error('\n   Stack trace:');
        console.error(error.stack.split('\n').map(line => `   ${line}`).join('\n'));
      }
    } else {
      console.error(`   Unknown error: ${String(error)}`);
    }

    console.error('\nCommon Issues:');
    console.error('  • Config file not found - check CONFIG_PATH');
    console.error('  • Invalid config format - verify JSON schema');
    console.error('  • Port in use - check SERVER_PORT');
    console.error('  • Keycloak not reachable - verify JWKS endpoint');
    console.error('');

    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n\n${signal} received - shutting down gracefully...`);

    if (server) {
      try {
        console.log('  • Stopping MCP server...');
        await server.stop();
        console.log('  • Server stopped\n');
        console.log('Goodbye!\n');
        process.exit(0);
      } catch (error) {
        console.error('  • Error during shutdown:', error);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
