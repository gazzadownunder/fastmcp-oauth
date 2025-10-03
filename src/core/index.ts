/**
 * Core Module Public API
 *
 * This is the public API for the Core authentication framework.
 * All exports follow one-way dependency: Core → Delegation → MCP
 *
 * CRITICAL: CoreContext is exported from HERE (Core layer), not from MCP layer.
 * This prevents circular dependencies.
 *
 * @see Phase 1.8 of refactor.md
 */

// ============================================================================
// Services
// ============================================================================

export { AuthenticationService } from './authentication-service.js';
export type {
  AuthConfig,
  AuthenticationResult,
} from './authentication-service.js';

export { SessionManager } from './session-manager.js';
export type {
  JWTPayload,
  PermissionConfig,
} from './session-manager.js';

export { JWTValidator } from './jwt-validator.js';
export type {
  IDPConfig,
  ValidationContext,
  JWTValidationResult,
} from './jwt-validator.js';

export { RoleMapper } from './role-mapper.js';
export type { RoleMappingConfig } from './role-mapper.js';

export { AuditService } from './audit-service.js';
export type {
  AuditServiceConfig,
  AuditStorage,
} from './audit-service.js';

export { CoreContextValidator } from './validators.js';

// ============================================================================
// Types
// ============================================================================

export type {
  CoreContext, // CRITICAL: Exported from Core layer (GAP #Architecture)
  UserSession,
  AuditEntry,
  RoleMapperResult,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

export {
  UNASSIGNED_ROLE,
  ROLE_ADMIN,
  ROLE_USER,
  ROLE_GUEST,
} from './types.js';
