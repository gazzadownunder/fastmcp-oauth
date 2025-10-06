/**
 * Error Handling Utilities for MCP Tools
 *
 * SECURITY (SEC-3): Prevents information leakage via error messages
 * - Logs full technical errors to AuditService
 * - Returns generic error messages to LLM clients
 * - Sanitizes sensitive data from parameters before logging
 *
 * @see Docs/security-gap-remediation.md SEC-3
 */

import type { AuditService } from '../../core/index.js';
import type { LLMFailureResponse, MCPContext } from '../types.js';

/**
 * Safely handle and log errors from tool execution.
 * Prevents information leakage while ensuring full error details are logged.
 *
 * SECURITY (SEC-3): All non-security errors are masked with generic message
 * - Full error (including stack trace) logged to audit for investigation
 * - Generic "SERVER_ERROR" response returned to client
 * - No file paths, database details, or internal structure exposed
 *
 * @param error - The caught error
 * @param toolName - Name of the tool for audit logging
 * @param mcpContext - MCP context (for session and audit access)
 * @param auditService - Audit service for logging
 * @param params - Tool parameters (for debugging)
 * @returns LLMFailureResponse with sanitized error message
 */
export async function handleToolError(
  error: unknown,
  toolName: string,
  mcpContext: MCPContext,
  auditService: AuditService | undefined,
  params: any
): Promise<LLMFailureResponse> {
  // Log full error details to audit
  if (auditService) {
    await auditService.log({
      timestamp: new Date(),
      source: `mcp:tool:${toolName}`,
      userId: mcpContext.session?.userId,
      action: 'tool_execution_error',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        stack: error instanceof Error ? error.stack : undefined,
        params: sanitizeParams(params), // Remove sensitive data
        errorType: error?.constructor?.name,
      },
    });
  }

  // Return generic error response (SECURITY: No technical details leaked)
  return {
    status: 'failure',
    code: 'SERVER_ERROR',
    message: 'An internal processing error occurred. Please contact support if this persists.',
  };
}

/**
 * Remove sensitive data from parameters before logging.
 *
 * SECURITY (SEC-3): Prevents PII and sensitive data from appearing in logs
 * - SQL queries may contain sensitive data in WHERE clauses
 * - Procedure parameters may contain PII
 * - Redacts while preserving structure for debugging
 *
 * @param params - Original tool parameters
 * @returns Sanitized parameters safe for logging
 */
function sanitizeParams(params: any): any {
  if (!params || typeof params !== 'object') {
    return params;
  }

  const sanitized = { ...params };

  // Remove SQL queries (may contain sensitive data)
  if (sanitized.sql) {
    sanitized.sql = '[REDACTED - SQL query]';
  }

  // Remove procedure parameters (may contain PII)
  if (sanitized.params && typeof sanitized.params === 'object') {
    const paramKeys = Object.keys(sanitized.params);
    sanitized.params = `[REDACTED - ${paramKeys.length} parameters: ${paramKeys.join(', ')}]`;
  }

  // Keep safe fields (action, resource, etc.)
  // These don't contain user data

  return sanitized;
}
