/**
 * MCP Configuration Orchestrator
 *
 * Responsible for building CoreContext from configuration and creating
 * all core services with proper dependency injection.
 *
 * CRITICAL (GAP #8, #11):
 * - CoreContext built with `satisfies CoreContext` operator (GAP #11)
 * - CoreContextValidator.validate() called in start() method (not constructor) (GAP #8)
 *
 * @see Phase 3.6 of refactor.md
 */

import type { CoreContext } from '../core/index.js';
import { CoreContextValidator } from '../core/validators.js';
import { AuditService } from '../core/audit-service.js';
import { JWTValidator } from '../core/jwt-validator.js';
import { RoleMapper } from '../core/role-mapper.js';
import { SessionManager } from '../core/session-manager.js';
import { AuthenticationService } from '../core/authentication-service.js';
import { DelegationRegistry } from '../delegation/registry.js';
import type { ConfigManager } from '../config/manager.js';
import type { UnifiedConfig } from '../config/schemas/index.js';

// ============================================================================
// Orchestrator Configuration
// ============================================================================

/**
 * Orchestrator options for customizing CoreContext creation
 */
export interface OrchestratorOptions {
  /** Configuration manager instance */
  configManager: ConfigManager;

  /** Enable audit logging (default: true) */
  enableAudit?: boolean;

  /** Custom audit overflow handler */
  onAuditOverflow?: (entries: any[]) => void;
}

// ============================================================================
// Configuration Orchestrator
// ============================================================================

/**
 * Configuration Orchestrator
 *
 * Builds CoreContext from configuration with proper dependency injection.
 *
 * Responsibilities:
 * - Load and subset configuration for each layer
 * - Create core services in correct order
 * - Build CoreContext with `satisfies` operator (GAP #11)
 * - Validate CoreContext before use (GAP #8)
 *
 * @example
 * ```typescript
 * const orchestrator = new ConfigOrchestrator({ configManager });
 * const coreContext = await orchestrator.buildCoreContext();
 *
 * // Validate before use (GAP #8)
 * CoreContextValidator.validate(coreContext);
 *
 * // Use in tools
 * const toolReg = createSqlTool(coreContext);
 * ```
 */
export class ConfigOrchestrator {
  private configManager: ConfigManager;
  private enableAudit: boolean;
  private onAuditOverflow?: (entries: any[]) => void;

  constructor(options: OrchestratorOptions) {
    this.configManager = options.configManager;
    this.enableAudit = options.enableAudit ?? true;
    this.onAuditOverflow = options.onAuditOverflow;
  }

  /**
   * Build CoreContext from configuration
   *
   * CRITICAL (GAP #11): Uses `satisfies CoreContext` operator to ensure
   * type safety without losing literal types.
   *
   * @returns CoreContext with all services initialized
   */
  async buildCoreContext(): Promise<CoreContext> {
    const config = this.configManager.getConfig();

    if (!config) {
      throw new Error('Configuration not loaded. Call configManager.loadConfig() first.');
    }

    // Create AuditService (Null Object Pattern if disabled)
    const auditService = this.createAuditService(config);

    // Create JWTValidator
    // Create AuthenticationService
    const authenticationService = this.createAuthenticationService(
      config,
      auditService
    );

    // Create DelegationRegistry
    const delegationRegistry = this.createDelegationRegistry(auditService);

    // MANDATORY (GAP #11): Build CoreContext with satisfies operator
    const coreContext = {
      authService: authenticationService,
      auditService,
      delegationRegistry,
      configManager: this.configManager,
    } satisfies CoreContext;

    return coreContext;
  }

  /**
   * Create AuditService from configuration
   *
   * Uses Null Object Pattern if audit is disabled.
   */
  private createAuditService(config: UnifiedConfig): AuditService {
    if (!this.enableAudit || !config.auth.audit?.enabled) {
      // Null Object Pattern - no audit logging
      return new AuditService();
    }

    return new AuditService({
      enabled: true,
      logAllAttempts: config.auth.audit.logAllAttempts ?? true,
      retentionDays: config.auth.audit.retentionDays ?? 90,
      onOverflow: this.onAuditOverflow,
    });
  }


  /**
   * Create AuthenticationService
   */
  private createAuthenticationService(
    config: UnifiedConfig,
    auditService: AuditService
  ): AuthenticationService {
    // Extract auth config for AuthenticationService
    const authConfig = {
      idpConfigs: config.auth.trustedIDPs,
      roleMappings: config.auth.trustedIDPs[0]?.roleMappings
        ? {
            adminRoles: config.auth.trustedIDPs[0].roleMappings.admin,
            userRoles: config.auth.trustedIDPs[0].roleMappings.user,
            guestRoles: config.auth.trustedIDPs[0].roleMappings.guest,
            defaultRole: config.auth.trustedIDPs[0].roleMappings.defaultRole,
          }
        : undefined,
    };

    return new AuthenticationService(authConfig, auditService);
  }

  /**
   * Create DelegationRegistry
   */
  private createDelegationRegistry(auditService: AuditService): DelegationRegistry {
    return new DelegationRegistry(auditService);
  }

  /**
   * Validate CoreContext before use
   *
   * CRITICAL (GAP #8): This should be called in start() method, NOT constructor.
   *
   * @param coreContext - CoreContext to validate
   * @throws {Error} If validation fails
   */
  static validateCoreContext(coreContext: CoreContext): void {
    CoreContextValidator.validate(coreContext);
  }

  /**
   * Destroy CoreContext and cleanup resources
   *
   * Calls destroy() on all services that have it.
   */
  static async destroyCoreContext(coreContext: CoreContext): Promise<void> {
    // Destroy delegation registry
    if (coreContext.delegationRegistry?.destroyAll) {
      await coreContext.delegationRegistry.destroyAll();
    }
  }
}
