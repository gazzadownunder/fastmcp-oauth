/**
 * Core Validators
 *
 * Centralized validation logic for the Core authentication framework.
 *
 * ARCHITECTURAL NOTE: This file is in the Core layer to maintain one-way
 * dependency flow (Core → Delegation → MCP). CoreContext is also defined
 * in Core (not MCP) to prevent circular dependencies.
 *
 * @see Phase 1.7 of refactor.md for architectural rationale
 */

import { CoreContext } from './types.js';

/**
 * CoreContextValidator provides runtime validation for CoreContext objects.
 *
 * CRITICAL: This validator imports CoreContext from './types.js' (Core layer),
 * NOT from '../mcp/types.js'. This enforces the architectural rule that Core
 * must never import from MCP or Delegation layers.
 *
 * Usage:
 * ```typescript
 * // In MCPOAuthServer.start():
 * CoreContextValidator.validate(this.coreContext);
 * ```
 *
 * @see Phase 0.2 and Phase 1.7 of refactor.md
 */
export class CoreContextValidator {
  /**
   * Validates that a CoreContext object has all required fields.
   *
   * MANDATORY (GAP #8): This validation should be called in the start()
   * method of MCPOAuthServer (NOT in the constructor), after all services
   * have been initialized.
   *
   * @param context - The CoreContext to validate
   * @throws {Error} If any required field is missing
   */
  static validate(context: CoreContext): void {
    // Validate context exists
    if (!context || typeof context !== 'object') {
      throw new Error(
        'CoreContext missing required field: context must be a valid object'
      );
    }

    if (!context.authService) {
      throw new Error(
        'CoreContext missing required field: authService. ' +
        'Ensure AuthenticationService is initialized before calling validate().'
      );
    }

    if (!context.auditService) {
      throw new Error(
        'CoreContext missing required field: auditService. ' +
        'Ensure AuditService is initialized before calling validate().'
      );
    }

    if (!context.delegationRegistry) {
      throw new Error(
        'CoreContext missing required field: delegationRegistry. ' +
        'Ensure DelegationRegistry is initialized before calling validate().'
      );
    }

    if (!context.configManager) {
      throw new Error(
        'CoreContext missing required field: configManager. ' +
        'Ensure ConfigManager is initialized before calling validate().'
      );
    }
  }

  /**
   * Validates that a CoreContext object is properly constructed.
   *
   * This is a type-safe alternative to validate() that can be used
   * in TypeScript code to ensure compile-time type safety.
   *
   * @param context - The CoreContext to check
   * @returns true if context has all required fields at compile-time
   */
  static isValid(context: unknown): context is CoreContext {
    return (
      typeof context === 'object' &&
      context !== null &&
      'authService' in context &&
      'auditService' in context &&
      'delegationRegistry' in context &&
      'configManager' in context
    );
  }
}
