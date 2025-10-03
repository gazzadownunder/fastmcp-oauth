// Main export file - re-exports all public APIs from modular architecture

// Core layer exports
export * from './core/index.js';

// Delegation layer exports
export * from './delegation/index.js';

// MCP layer exports
export * from './mcp/index.js';

// Configuration exports
export {
  ConfigManager,
  migrateConfig,
  type UnifiedConfig,
  type CoreAuthConfig,
  type DelegationConfig,
  type MCPConfig
} from './config/index.js';

// Utility exports
export * from './utils/errors.js';
