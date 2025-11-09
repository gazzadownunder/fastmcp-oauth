import type { SecurityError } from '../types/index.js';

export class OAuthSecurityError extends Error implements SecurityError {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OAuthSecurityError';

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OAuthSecurityError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export function createSecurityError(
  code: string,
  message: string,
  statusCode: number = 500,
  details?: Record<string, unknown>
): OAuthSecurityError {
  return new OAuthSecurityError(code, message, statusCode, details);
}

// Predefined security error types
export const SecurityErrors = {
  INVALID_TOKEN_FORMAT: (details?: Record<string, unknown>) =>
    createSecurityError('INVALID_TOKEN_FORMAT', 'Invalid JWT format', 400, details),

  UNTRUSTED_ISSUER: (issuer: string) =>
    createSecurityError('UNTRUSTED_ISSUER', `Untrusted issuer: ${issuer}`, 401),

  TOKEN_EXPIRED: (details?: Record<string, unknown>) =>
    createSecurityError('TOKEN_EXPIRED', 'Token has expired', 401, details),

  INVALID_SIGNATURE: (details?: Record<string, unknown>) =>
    createSecurityError('INVALID_SIGNATURE', 'Invalid token signature', 401, details),

  MISSING_CLAIMS: (claim: string) =>
    createSecurityError('MISSING_CLAIMS', `Missing required claim: ${claim}`, 400),

  ALGORITHM_NOT_ALLOWED: (algorithm: string) =>
    createSecurityError('ALGORITHM_NOT_ALLOWED', `Algorithm not allowed: ${algorithm}`, 400),

  RATE_LIMIT_EXCEEDED: (details?: Record<string, unknown>) =>
    createSecurityError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', 429, details),

  DELEGATION_FAILED: (type: string, reason: string) =>
    createSecurityError('DELEGATION_FAILED', `${type} delegation failed: ${reason}`, 403),

  INSUFFICIENT_PERMISSIONS: (action: string) =>
    createSecurityError('INSUFFICIENT_PERMISSIONS', `Insufficient permissions for: ${action}`, 403),

  CONFIGURATION_ERROR: (message: string) =>
    createSecurityError('CONFIGURATION_ERROR', `Configuration error: ${message}`, 500),
} as const;

// Error sanitization for logging
export function sanitizeError(error: unknown): Record<string, unknown> {
  if (error instanceof OAuthSecurityError) {
    return {
      type: 'SecurityError',
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      // Don't include details in production to prevent information leakage
      ...(process.env.NODE_ENV !== 'production' && { details: error.details }),
    };
  }

  if (error instanceof Error) {
    return {
      type: 'Error',
      message: error.message,
      name: error.name,
      // Only include stack trace in development
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    };
  }

  return {
    type: 'Unknown',
    message: 'An unknown error occurred',
  };
}

// HTTP response helper
export function createErrorResponse(error: SecurityError): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  return {
    statusCode: error.statusCode,
    body: {
      error: {
        code: error.code,
        message: error.message,
        // Only include details in development
        ...(process.env.NODE_ENV === 'development' && error.details && { details: error.details }),
      },
    },
  };
}
