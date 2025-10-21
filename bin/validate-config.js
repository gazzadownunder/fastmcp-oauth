#!/usr/bin/env node

/**
 * MCP OAuth Configuration Validator
 *
 * CLI tool to validate configuration files against the schema.
 *
 * Usage:
 *   npx mcp-oauth-validate <config-file>
 *   npx mcp-oauth-validate ./config/my-config.json
 *
 * Options:
 *   --verbose    Show detailed validation results
 *   --json       Output results as JSON
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const configFile = args[0];

if (!configFile) {
  console.error('❌ Error: Configuration file path is required');
  console.log('\nUsage: npx mcp-oauth-validate <config-file> [options]');
  console.log('\nOptions:');
  console.log('  --verbose    Show detailed validation results');
  console.log('  --json       Output results as JSON');
  console.log('\nExample:');
  console.log('  npx mcp-oauth-validate ./config/my-config.json');
  process.exit(1);
}

const verbose = args.includes('--verbose');
const jsonOutput = args.includes('--json');

// Validation results
const results = {
  valid: true,
  errors: [],
  warnings: [],
  info: [],
};

function addError(message, field) {
  results.valid = false;
  results.errors.push({ message, field });
}

function addWarning(message, field) {
  results.warnings.push({ message, field });
}

function addInfo(message, field) {
  results.info.push({ message, field });
}

// Read and parse configuration file
let config;
try {
  const configPath = path.resolve(configFile);

  if (!fs.existsSync(configPath)) {
    addError(`Configuration file not found: ${configFile}`, null);
    outputResults();
    process.exit(1);
  }

  const configContent = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configContent);

  addInfo(`Configuration file loaded: ${configPath}`, null);
} catch (error) {
  addError(`Failed to parse configuration file: ${error.message}`, null);
  outputResults();
  process.exit(1);
}

// Validate configuration structure
function validateConfig(config) {
  // Validate auth section
  if (!config.auth) {
    addError('Missing required section: auth', 'auth');
  } else {
    validateAuth(config.auth);
  }

  // Validate delegation section (optional)
  if (config.delegation) {
    validateDelegation(config.delegation);
  }

  // Validate MCP section (optional)
  if (config.mcp) {
    validateMCP(config.mcp);
  }

  // Check for unknown top-level keys
  const validKeys = ['auth', 'delegation', 'mcp', 'server'];
  const unknownKeys = Object.keys(config).filter(k => !validKeys.includes(k));
  if (unknownKeys.length > 0) {
    addWarning(`Unknown configuration keys: ${unknownKeys.join(', ')}`, null);
  }
}

function validateAuth(auth) {
  // Validate trustedIDPs
  if (!auth.trustedIDPs || !Array.isArray(auth.trustedIDPs)) {
    addError('Missing or invalid auth.trustedIDPs (must be an array)', 'auth.trustedIDPs');
  } else {
    if (auth.trustedIDPs.length === 0) {
      addWarning('No trusted IDPs configured', 'auth.trustedIDPs');
    }

    auth.trustedIDPs.forEach((idp, index) => {
      validateIDP(idp, index);
    });
  }

  // Validate roleMappings (optional)
  if (auth.roleMappings) {
    validateRoleMappings(auth.roleMappings);
  }

  // Validate audit settings (optional)
  if (auth.audit) {
    validateAudit(auth.audit);
  }

  // Validate rate limiting (optional)
  if (auth.rateLimiting) {
    validateRateLimiting(auth.rateLimiting);
  }
}

function validateIDP(idp, index) {
  const prefix = `auth.trustedIDPs[${index}]`;

  // Required fields
  if (!idp.issuer) {
    addError('Missing required field: issuer', `${prefix}.issuer`);
  } else if (!idp.issuer.startsWith('https://')) {
    addError('Issuer must use HTTPS', `${prefix}.issuer`);
  }

  if (!idp.jwksUri && !idp.discoveryUrl) {
    addError('Must provide either jwksUri or discoveryUrl', prefix);
  }

  if (idp.jwksUri && !idp.jwksUri.startsWith('https://')) {
    addError('jwksUri must use HTTPS', `${prefix}.jwksUri`);
  }

  if (idp.discoveryUrl && !idp.discoveryUrl.startsWith('https://')) {
    addError('discoveryUrl must use HTTPS', `${prefix}.discoveryUrl`);
  }

  // Validate audience
  if (!idp.audience) {
    addWarning('No audience specified (tokens will not be validated for audience)', `${prefix}.audience`);
  }

  // Validate algorithms
  if (idp.algorithms) {
    const validAlgorithms = ['RS256', 'ES256', 'RS384', 'ES384', 'RS512', 'ES512'];
    const invalidAlgorithms = idp.algorithms.filter(alg => !validAlgorithms.includes(alg));

    if (invalidAlgorithms.length > 0) {
      addError(`Invalid algorithms: ${invalidAlgorithms.join(', ')}. Valid: ${validAlgorithms.join(', ')}`, `${prefix}.algorithms`);
    }

    if (idp.algorithms.includes('HS256') || idp.algorithms.includes('HS384') || idp.algorithms.includes('HS512')) {
      addError('HMAC algorithms (HS256, HS384, HS512) are not allowed for security reasons', `${prefix}.algorithms`);
    }
  }

  // Validate claim mappings (optional)
  if (idp.claimMappings) {
    if (typeof idp.claimMappings !== 'object') {
      addError('claimMappings must be an object', `${prefix}.claimMappings`);
    }
  }

  // Validate security settings (optional)
  if (idp.security) {
    validateIDPSecurity(idp.security, prefix);
  }

  // Validate token exchange settings (optional)
  if (idp.tokenExchange) {
    validateTokenExchange(idp.tokenExchange, prefix);
  }
}

function validateIDPSecurity(security, prefix) {
  if (security.clockTolerance !== undefined) {
    if (typeof security.clockTolerance !== 'number' || security.clockTolerance < 0) {
      addError('clockTolerance must be a positive number', `${prefix}.security.clockTolerance`);
    } else if (security.clockTolerance > 300) {
      addWarning('clockTolerance > 300 seconds may pose security risks', `${prefix}.security.clockTolerance`);
    }
  }

  if (security.maxTokenAge !== undefined) {
    if (typeof security.maxTokenAge !== 'number' || security.maxTokenAge < 300) {
      addError('maxTokenAge must be at least 300 seconds (5 minutes)', `${prefix}.security.maxTokenAge`);
    } else if (security.maxTokenAge > 86400) {
      addWarning('maxTokenAge > 24 hours may pose security risks', `${prefix}.security.maxTokenAge`);
    }
  }

  if (security.requireNbf !== undefined && typeof security.requireNbf !== 'boolean') {
    addError('requireNbf must be a boolean', `${prefix}.security.requireNbf`);
  }
}

function validateTokenExchange(tokenExchange, prefix) {
  if (!tokenExchange.tokenEndpoint) {
    addError('Missing required field: tokenEndpoint', `${prefix}.tokenExchange.tokenEndpoint`);
  } else if (!tokenExchange.tokenEndpoint.startsWith('https://')) {
    addError('tokenEndpoint must use HTTPS', `${prefix}.tokenExchange.tokenEndpoint`);
  }

  if (!tokenExchange.clientId) {
    addError('Missing required field: clientId', `${prefix}.tokenExchange.clientId`);
  }

  if (!tokenExchange.clientSecret) {
    addWarning('Missing clientSecret (required for token exchange)', `${prefix}.tokenExchange.clientSecret`);
  }

  if (tokenExchange.cache) {
    validateTokenCache(tokenExchange.cache, `${prefix}.tokenExchange.cache`);
  }
}

function validateTokenCache(cache, prefix) {
  if (cache.enabled !== undefined && typeof cache.enabled !== 'boolean') {
    addError('cache.enabled must be a boolean', `${prefix}.enabled`);
  }

  if (cache.ttlSeconds !== undefined) {
    if (typeof cache.ttlSeconds !== 'number' || cache.ttlSeconds < 1) {
      addError('cache.ttlSeconds must be a positive number', `${prefix}.ttlSeconds`);
    }
  }

  if (cache.maxEntriesPerSession !== undefined) {
    if (typeof cache.maxEntriesPerSession !== 'number' || cache.maxEntriesPerSession < 1) {
      addError('cache.maxEntriesPerSession must be a positive number', `${prefix}.maxEntriesPerSession`);
    }
  }
}

function validateRoleMappings(roleMappings) {
  const validRoles = ['admin', 'user', 'guest'];

  for (const role of validRoles) {
    if (roleMappings[role] && !Array.isArray(roleMappings[role])) {
      addError(`roleMappings.${role} must be an array`, `auth.roleMappings.${role}`);
    }
  }

  if (roleMappings.defaultRole && !validRoles.includes(roleMappings.defaultRole)) {
    addWarning(`defaultRole "${roleMappings.defaultRole}" is not a standard role (admin, user, guest)`, 'auth.roleMappings.defaultRole');
  }

  if (roleMappings.rejectUnmappedRoles !== undefined && typeof roleMappings.rejectUnmappedRoles !== 'boolean') {
    addError('rejectUnmappedRoles must be a boolean', 'auth.roleMappings.rejectUnmappedRoles');
  }
}

function validateAudit(audit) {
  if (audit.logAllAttempts !== undefined && typeof audit.logAllAttempts !== 'boolean') {
    addError('audit.logAllAttempts must be a boolean', 'auth.audit.logAllAttempts');
  }

  if (audit.retentionDays !== undefined) {
    if (typeof audit.retentionDays !== 'number' || audit.retentionDays < 1) {
      addError('audit.retentionDays must be a positive number', 'auth.audit.retentionDays');
    }
  }
}

function validateRateLimiting(rateLimiting) {
  if (rateLimiting.maxRequests !== undefined) {
    if (typeof rateLimiting.maxRequests !== 'number' || rateLimiting.maxRequests < 1) {
      addError('rateLimiting.maxRequests must be a positive number', 'auth.rateLimiting.maxRequests');
    }
  }

  if (rateLimiting.windowMs !== undefined) {
    if (typeof rateLimiting.windowMs !== 'number' || rateLimiting.windowMs < 1000) {
      addError('rateLimiting.windowMs must be at least 1000ms (1 second)', 'auth.rateLimiting.windowMs');
    }
  }
}

function validateDelegation(delegation) {
  if (!delegation.modules || typeof delegation.modules !== 'object') {
    addWarning('delegation.modules should be an object', 'delegation.modules');
    return;
  }

  // Validate SQL module (if present)
  if (delegation.modules.sql) {
    validateSQLModule(delegation.modules.sql);
  }

  // Validate Kerberos module (if present)
  if (delegation.modules.kerberos) {
    validateKerberosModule(delegation.modules.kerberos);
  }
}

function validateSQLModule(sql) {
  if (!sql.server) {
    addError('Missing required field: server', 'delegation.modules.sql.server');
  }

  if (!sql.database) {
    addError('Missing required field: database', 'delegation.modules.sql.database');
  }

  if (sql.options) {
    if (sql.options.trustedConnection === false && !sql.user) {
      addWarning('SQL authentication requires user/password or trustedConnection', 'delegation.modules.sql');
    }

    if (sql.options.encrypt === false) {
      addWarning('SQL connection encryption is disabled (not recommended for production)', 'delegation.modules.sql.options.encrypt');
    }
  }
}

function validateKerberosModule(kerberos) {
  if (!kerberos.realm) {
    addError('Missing required field: realm', 'delegation.modules.kerberos.realm');
  }

  if (!kerberos.kdc) {
    addError('Missing required field: kdc', 'delegation.modules.kerberos.kdc');
  }

  if (!kerberos.servicePrincipal) {
    addWarning('Missing servicePrincipal (may be required for S4U delegation)', 'delegation.modules.kerberos.servicePrincipal');
  }
}

function validateMCP(mcp) {
  if (mcp.serverName && typeof mcp.serverName !== 'string') {
    addError('mcp.serverName must be a string', 'mcp.serverName');
  }

  if (mcp.version && typeof mcp.version !== 'string') {
    addError('mcp.version must be a string', 'mcp.version');
  }

  if (mcp.transport && !['stdio', 'sse', 'httpStream'].includes(mcp.transport)) {
    addError('mcp.transport must be one of: stdio, sse, httpStream', 'mcp.transport');
  }

  if (mcp.port !== undefined) {
    if (typeof mcp.port !== 'number' || mcp.port < 1 || mcp.port > 65535) {
      addError('mcp.port must be a number between 1 and 65535', 'mcp.port');
    }
  }
}

function outputResults() {
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('\n🔍 Configuration Validation Results\n');
    console.log('━'.repeat(60));

    // Show errors
    if (results.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      results.errors.forEach(({ message, field }) => {
        console.log(`   ${field ? `[${field}]` : ''} ${message}`);
      });
    }

    // Show warnings
    if (results.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      results.warnings.forEach(({ message, field }) => {
        console.log(`   ${field ? `[${field}]` : ''} ${message}`);
      });
    }

    // Show info (verbose mode only)
    if (verbose && results.info.length > 0) {
      console.log('\nℹ️  INFO:');
      results.info.forEach(({ message, field }) => {
        console.log(`   ${field ? `[${field}]` : ''} ${message}`);
      });
    }

    console.log('\n' + '━'.repeat(60));

    if (results.valid) {
      console.log('\n✅ Configuration is valid!\n');
    } else {
      console.log(`\n❌ Configuration is invalid (${results.errors.length} error${results.errors.length === 1 ? '' : 's'})\n`);
    }

    if (results.warnings.length > 0) {
      console.log(`⚠️  ${results.warnings.length} warning${results.warnings.length === 1 ? '' : 's'} found\n`);
    }
  }

  process.exit(results.valid ? 0 : 1);
}

// Run validation
validateConfig(config);
outputResults();
