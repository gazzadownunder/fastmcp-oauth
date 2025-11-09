/**
 * Delegation Registry - Central registry for delegation modules
 *
 * Manages registration, lifecycle, and delegation routing for all modules.
 * Integrates with AuditService to log all delegation events.
 *
 * Critical Design:
 * - Modules create AuditEntry objects (auditTrail)
 * - Registry logs the auditTrail to AuditService
 * - Modules don't need direct AuditService injection
 *
 * @see Phase 2.2 of refactor.md
 */

import type { UserSession, AuditEntry } from '../core/index.js';
import { AuditService } from '../core/index.js';
import type { DelegationModule, DelegationResult } from './base.js';

// ============================================================================
// Delegation Registry
// ============================================================================

/**
 * DelegationRegistry - Manages all delegation modules
 *
 * Responsibilities:
 * - Module registration and lifecycle management
 * - Centralized delegation routing
 * - Audit logging for all delegation events
 *
 * Enhancement v0.2: Integrates with AuditService
 * - Logs module registration events
 * - Logs all delegation attempts (success and failure)
 * - Ensures all audit entries have source field (GAP #3)
 *
 * Usage:
 * ```typescript
 * const registry = new DelegationRegistry(auditService);
 * registry.register(sqlModule);
 * const result = await registry.delegate('sql', session, 'query', params);
 * ```
 */
export class DelegationRegistry {
  private modules: Map<string, DelegationModule> = new Map();
  private auditService?: AuditService;
  private coreContext?: any; // CoreContext for delegation module context injection

  /**
   * Create delegation registry
   *
   * @param auditService - Optional audit service for logging (Null Object Pattern)
   */
  constructor(auditService?: AuditService) {
    this.auditService = auditService;
  }

  /**
   * Set CoreContext for delegation module context injection
   *
   * **Phase 2 Enhancement:** Enables modules to access framework services
   * like TokenExchangeService via the context parameter.
   *
   * @param coreContext - CoreContext with all framework services
   */
  setCoreContext(coreContext: any): void {
    this.coreContext = coreContext;
  }

  /**
   * Register a delegation module
   *
   * @param module - Module to register
   * @throws Error if module with same name already registered
   */
  register(module: DelegationModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Delegation module already registered: ${module.name}`);
    }

    this.modules.set(module.name, module);

    // Enhancement v0.2: Log registration event
    // MANDATORY (GAP #3): Include source field
    this.auditService?.log({
      timestamp: new Date(),
      source: 'delegation:registry',
      action: 'delegation_module_registered',
      success: true,
      metadata: { moduleName: module.name, moduleType: module.type },
    });
  }

  /**
   * Unregister a delegation module
   *
   * @param name - Name of module to unregister
   * @returns true if module was unregistered, false if not found
   */
  unregister(name: string): boolean {
    const removed = this.modules.delete(name);

    if (removed) {
      this.auditService?.log({
        timestamp: new Date(),
        source: 'delegation:registry',
        action: 'delegation_module_unregistered',
        success: true,
        metadata: { moduleName: name },
      });
    }

    return removed;
  }

  /**
   * Get a registered module by name
   *
   * @param name - Module name
   * @returns Module or undefined if not found
   */
  get(name: string): DelegationModule | undefined {
    return this.modules.get(name);
  }

  /**
   * List all registered modules
   *
   * @returns Array of all registered modules
   */
  list(): DelegationModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Check if a module is registered
   *
   * @param name - Module name
   * @returns true if registered, false otherwise
   */
  has(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * Delegate an action through a specific module
   *
   * Enhancement v0.2: Centralized delegation with audit logging
   * - Validates module exists
   * - Calls module.delegate()
   * - Ensures auditTrail has source field (GAP #3)
   * - Logs auditTrail to AuditService
   *
   * Enhancement Phase 2: CoreContext injection
   * - Passes CoreContext to delegation modules via context parameter
   * - Enables modules to access TokenExchangeService and other framework services
   * - Backward compatible (existing modules work without context)
   *
   * SECURITY (SEC-1): Trust Boundary Enforcement
   * - Registry independently verifies result.success (ground truth)
   * - Captures what module reported vs. what registry observed
   * - Detects discrepancies and logs trust_boundary_violation events
   * - Injects mandatory integrity fields: registryVerifiedSuccess, registryTimestamp
   *
   * @param moduleName - Name of module to use
   * @param session - User session
   * @param action - Action to perform
   * @param params - Action parameters
   * @param sessionId - Optional session ID for token caching
   * @returns Delegation result with audit trail
   */
  async delegate<T = unknown>(
    moduleName: string,
    session: UserSession,
    action: string,
    params: any,
    sessionId?: string
  ): Promise<DelegationResult<T>> {
    const module = this.get(moduleName);

    if (!module) {
      // MANDATORY (GAP #3): Include source field
      const auditEntry: AuditEntry = {
        timestamp: new Date(),
        source: 'delegation:registry',
        userId: session.userId,
        action: 'delegation_failed',
        success: false,
        reason: `Module not found: ${moduleName}`,
        metadata: {
          requestedModule: moduleName,
          availableModules: Array.from(this.modules.keys()),
        },
        // SECURITY (SEC-1): Registry verification for module-not-found case
        registryVerifiedSuccess: false,
        registryTimestamp: new Date(),
      };
      await this.auditService?.log(auditEntry);

      return {
        success: false,
        error: `Module not found: ${moduleName}`,
        auditTrail: auditEntry,
      };
    }

    // Call module delegation with CoreContext (Phase 2 enhancement)
    const result = await module.delegate<T>(session, action, params, {
      sessionId,
      coreContext: this.coreContext,
    });

    // SECURITY (SEC-1): Registry's ground truth - independently verify success
    const registryTimestamp = new Date();
    const registryVerifiedSuccess = result.success;

    // MANDATORY (GAP #3): Ensure module's auditTrail has source field
    // If module didn't set source, default to 'delegation:{moduleName}'
    if (!result.auditTrail.source) {
      result.auditTrail.source = `delegation:${module.name}`;
    }

    // SECURITY (SEC-1): Inject trust boundary fields
    const enhancedAuditTrail: AuditEntry = {
      ...result.auditTrail,
      moduleReportedSuccess: result.auditTrail.success, // What module claimed
      registryVerifiedSuccess, // What registry observed (ground truth)
      registryTimestamp, // Registry's independent timestamp
      userId: session.userId, // Ensure userId is always set
    };

    // SECURITY (SEC-1): Detect trust boundary violations
    if (enhancedAuditTrail.moduleReportedSuccess !== registryVerifiedSuccess) {
      // Log discrepancy as security event
      await this.auditService?.log({
        timestamp: registryTimestamp,
        source: 'delegation:registry:security',
        userId: session.userId,
        action: 'trust_boundary_violation',
        success: false,
        reason: `Module ${module.name} reported success=${enhancedAuditTrail.moduleReportedSuccess} but registry observed success=${registryVerifiedSuccess}`,
        metadata: {
          moduleName: module.name,
          moduleType: module.type,
          delegationAction: action,
          moduleReportedSuccess: enhancedAuditTrail.moduleReportedSuccess,
          registryVerifiedSuccess,
        },
      });
    }

    // Enhancement v0.2: Log the enhanced audit trail
    await this.auditService?.log(enhancedAuditTrail);

    // Return result with enhanced audit trail
    return {
      ...result,
      auditTrail: enhancedAuditTrail,
    };
  }

  /**
   * Initialize all registered modules
   *
   * @param configs - Configuration map (module name -> config)
   */
  async initializeAll(configs: Record<string, any>): Promise<void> {
    const results: Array<{ module: string; success: boolean; error?: string }> = [];

    for (const module of this.modules.values()) {
      try {
        const config = configs[module.name];
        if (!config) {
          throw new Error(`No configuration found for module: ${module.name}`);
        }

        await module.initialize(config);
        results.push({ module: module.name, success: true });

        this.auditService?.log({
          timestamp: new Date(),
          source: 'delegation:registry',
          action: 'delegation_module_initialized',
          success: true,
          metadata: { moduleName: module.name },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.push({ module: module.name, success: false, error: errorMsg });

        this.auditService?.log({
          timestamp: new Date(),
          source: 'delegation:registry',
          action: 'delegation_module_initialization_failed',
          success: false,
          error: errorMsg,
          metadata: { moduleName: module.name },
        });
      }
    }

    // If any module failed, throw error with details
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      throw new Error(
        `Module initialization failed: ${failures.map((f) => `${f.module} (${f.error})`).join(', ')}`
      );
    }
  }

  /**
   * Destroy all registered modules
   *
   * Cleans up resources for all modules
   */
  async destroyAll(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.destroy();

        this.auditService?.log({
          timestamp: new Date(),
          source: 'delegation:registry',
          action: 'delegation_module_destroyed',
          success: true,
          metadata: { moduleName: module.name },
        });
      } catch (error) {
        this.auditService?.log({
          timestamp: new Date(),
          source: 'delegation:registry',
          action: 'delegation_module_destroy_failed',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: { moduleName: module.name },
        });
      }
    }

    this.modules.clear();
  }

  /**
   * Health check for all modules
   *
   * @returns Map of module name to health status
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const module of this.modules.values()) {
      try {
        const healthy = await module.healthCheck();
        results.set(module.name, healthy);
      } catch (error) {
        results.set(module.name, false);
      }
    }

    return results;
  }
}
