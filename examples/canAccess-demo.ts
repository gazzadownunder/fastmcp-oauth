/**
 * Example: Two-Tier Security with canAccess
 *
 * Demonstrates defense-in-depth using FastMCP's canAccess property:
 * 1. Visibility tier (canAccess - soft check) - controls tool visibility
 * 2. Execution tier (handler - hard check) - enforces permissions
 *
 * This pattern ensures:
 * - Users don't see tools they can't use (better UX)
 * - Security is still enforced even if visibility check fails (defense-in-depth)
 *
 * @see Phase-0-Discovery-Report.md for FastMCP canAccess API verification
 */

import type { UserSession } from '../src/core/types.js';
import type { MCPContext } from '../src/mcp/types.js';
import { createSecurityError } from '../src/utils/errors.js';

// ============================================================================
// Authorization Helper (Simplified for Demo)
// ============================================================================

class Authorization {
  // Soft checks (return boolean, don't throw)
  static hasRole(session: UserSession | null | undefined, role: string): boolean {
    if (!session || session.rejected) {
      return false;
    }
    return session.role === role;
  }

  static hasAnyRole(session: UserSession | null | undefined, roles: string[]): boolean {
    if (!session || session.rejected) {
      return false;
    }
    return roles.includes(session.role);
  }

  static hasPermission(session: UserSession | null | undefined, permission: string): boolean {
    if (!session || session.rejected) {
      return false;
    }
    return session.permissions.includes(permission);
  }

  // Hard checks (throw on failure)
  static requireRole(session: UserSession | null | undefined, role: string): void {
    if (!session || session.rejected) {
      throw createSecurityError('UNAUTHENTICATED', 'Authentication required', 401);
    }
    if (session.role !== role) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `Requires '${role}' role. Your role: ${session.role}`,
        403
      );
    }
  }

  static requireAnyRole(session: UserSession | null | undefined, roles: string[]): void {
    if (!session || session.rejected) {
      throw createSecurityError('UNAUTHENTICATED', 'Authentication required', 401);
    }
    if (!roles.includes(session.role)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `Requires one of: ${roles.join(', ')}. Your role: ${session.role}`,
        403
      );
    }
  }

  static requirePermission(session: UserSession | null | undefined, permission: string): void {
    if (!session || session.rejected) {
      throw createSecurityError('UNAUTHENTICATED', 'Authentication required', 401);
    }
    if (!session.permissions.includes(permission)) {
      throw createSecurityError(
        'INSUFFICIENT_PERMISSIONS',
        `Requires permission: ${permission}`,
        403
      );
    }
  }
}

// ============================================================================
// Example 1: Admin-Only Tool
// ============================================================================

/**
 * Tool that only admins can see and use
 */
const adminOnlyTool = {
  name: 'admin-tool',
  description: 'Perform administrative operations (admin role required)',

  // TIER 1: Visibility filtering (soft check)
  // Only admins see this tool in their tool list
  canAccess: (mcpContext: MCPContext) => {
    return Authorization.hasRole(mcpContext.session, 'admin');
  },

  // TIER 2: Execution enforcement (hard check)
  // Defense-in-depth: still verify role even if canAccess was bypassed
  execute: async (args: any, context: any) => {
    const mcpContext: MCPContext = { session: context.session };

    // This will throw if not admin
    Authorization.requireRole(mcpContext.session, 'admin');

    // Perform admin operation
    return {
      status: 'success',
      message: 'Admin operation completed successfully',
    };
  },
};

// ============================================================================
// Example 2: Multi-Role Tool (User or Admin)
// ============================================================================

/**
 * Tool accessible to both users and admins
 */
const userOrAdminTool = {
  name: 'user-tool',
  description: 'Perform user operations (user or admin role required)',

  // TIER 1: Visibility filtering
  // Show to users and admins
  canAccess: (mcpContext: MCPContext) => {
    return Authorization.hasAnyRole(mcpContext.session, ['user', 'admin']);
  },

  // TIER 2: Execution enforcement
  execute: async (args: any, context: any) => {
    const mcpContext: MCPContext = { session: context.session };

    Authorization.requireAnyRole(mcpContext.session, ['user', 'admin']);

    return {
      status: 'success',
      message: 'User operation completed successfully',
      role: mcpContext.session.role,
    };
  },
};

// ============================================================================
// Example 3: Permission-Based Tool
// ============================================================================

/**
 * Tool that requires specific permission (e.g., sql:query)
 */
const sqlQueryTool = {
  name: 'sql-query',
  description: 'Execute SQL queries (requires sql:query permission)',

  // TIER 1: Visibility filtering
  // Only show to users with sql:query permission
  canAccess: (mcpContext: MCPContext) => {
    return Authorization.hasPermission(mcpContext.session, 'sql:query');
  },

  // TIER 2: Execution enforcement
  execute: async (args: any, context: any) => {
    const mcpContext: MCPContext = { session: context.session };

    Authorization.requirePermission(mcpContext.session, 'sql:query');

    // Perform SQL operation
    return {
      status: 'success',
      message: 'SQL query executed successfully',
      query: args.sql || 'SELECT * FROM example',
    };
  },
};

// ============================================================================
// Example 4: Multiple Permission Check
// ============================================================================

/**
 * Tool that requires ANY of several permissions
 */
const sqlDelegateTool = {
  name: 'sql-delegate',
  description: 'Execute SQL operations (requires any sql:* permission)',

  // TIER 1: Visibility filtering
  // Show if user has ANY sql permission
  canAccess: (mcpContext: MCPContext) => {
    if (!mcpContext.session || mcpContext.session.rejected) {
      return false;
    }

    // Check if user has ANY sql permission
    return mcpContext.session.permissions.some(p => p.startsWith('sql:'));
  },

  // TIER 2: Execution enforcement
  // Specific permission checked based on action
  execute: async (args: any, context: any) => {
    const mcpContext: MCPContext = { session: context.session };

    const action = args.action || 'query';
    const requiredPermission = `sql:${action}`;

    Authorization.requirePermission(mcpContext.session, requiredPermission);

    return {
      status: 'success',
      message: `SQL ${action} operation completed successfully`,
      action,
    };
  },
};

// ============================================================================
// Example 5: Unauthenticated (Public) Tool
// ============================================================================

/**
 * Tool accessible to everyone (even unauthenticated users)
 */
const publicTool = {
  name: 'health-check',
  description: 'Check server health (public access)',

  // TIER 1: Visibility filtering
  // Always visible (no auth required)
  canAccess: (mcpContext: MCPContext) => {
    return true; // Always show this tool
  },

  // TIER 2: Execution (no auth required)
  execute: async (args: any, context: any) => {
    // No authentication check needed for public endpoint

    return {
      status: 'success',
      healthy: true,
      uptime: process.uptime(),
    };
  },
};

// ============================================================================
// Example 6: Guest with Upgrade Path
// ============================================================================

/**
 * Tool visible to guests but requires upgrade to use
 */
const freemiumTool = {
  name: 'premium-feature',
  description: 'Premium feature (visible to all, usable by user/admin)',

  // TIER 1: Visibility filtering
  // Show to everyone (including guests) to encourage upgrades
  canAccess: (mcpContext: MCPContext) => {
    return true; // Always visible
  },

  // TIER 2: Execution enforcement
  // But require user or admin role to actually use
  execute: async (args: any, context: any) => {
    const mcpContext: MCPContext = { session: context.session };

    // Check if guest role
    if (mcpContext.session.role === 'guest') {
      return {
        status: 'failure',
        code: 'UPGRADE_REQUIRED',
        message: 'This feature requires a user or admin account. Please upgrade your account.',
        upgradeUrl: 'https://example.com/upgrade',
      };
    }

    Authorization.requireAnyRole(mcpContext.session, ['user', 'admin']);

    return {
      status: 'success',
      message: 'Premium feature executed successfully',
    };
  },
};

// ============================================================================
// Summary of Patterns
// ============================================================================

console.log(`
Two-Tier Security Patterns Demonstrated:

1. Admin-Only Tool
   - canAccess: Only admins see it
   - execute: Enforces admin role

2. Multi-Role Tool
   - canAccess: Users and admins see it
   - execute: Enforces user OR admin role

3. Permission-Based Tool
   - canAccess: Check specific permission
   - execute: Enforce same permission

4. Multiple Permission Tool
   - canAccess: Check for ANY permission in group
   - execute: Enforce specific permission based on action

5. Public Tool
   - canAccess: Always true
   - execute: No auth required

6. Freemium Tool
   - canAccess: Always true (show to encourage upgrades)
   - execute: Require upgraded account

Key Principles:
- canAccess = Soft check (UX optimization, returns boolean)
- execute handler = Hard check (security enforcement, throws on failure)
- Always implement BOTH checks for defense-in-depth
- canAccess should use soft check methods (hasRole, hasPermission)
- execute should use hard check methods (requireRole, requirePermission)
`);

// Export examples for testing/documentation
export {
  adminOnlyTool,
  userOrAdminTool,
  sqlQueryTool,
  sqlDelegateTool,
  publicTool,
  freemiumTool,
  Authorization,
};
