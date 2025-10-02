// Core types for FastMCP OAuth OBO framework

export interface UserSession {
  permissions: string[];
  role: string; // Primary role - can be standard ('admin'|'user'|'guest') or custom ('write'|'read'|'auditor')
  customRoles?: string[]; // Additional custom roles when multiple roles match
  userId: string;
  username: string;
  legacyUsername?: string;
  scopes?: string[];
  claims?: Record<string, unknown>;
}

export interface IDPConfig {
  issuer: string;
  discoveryUrl: string;
  jwksUri: string;
  audience: string;
  algorithms: string[];
  claimMappings: ClaimMappings;
  security: SecurityConfig;
}

export interface ClaimMappings {
  legacyUsername: string;
  roles: string;
  scopes: string;
  userId?: string;
  username?: string;
}

export interface SecurityConfig {
  clockTolerance: number;
  maxTokenAge: number;
  requireNbf: boolean;
}

export interface OAuthOBOConfig {
  trustedIDPs: IDPConfig[];
  rateLimiting: RateLimitConfig;
  audit: AuditConfig;
  kerberos?: KerberosConfig;
  sql?: SQLConfig;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface AuditConfig {
  logAllAttempts: boolean;
  logFailedAttempts: boolean;
  retentionDays: number;
}

export interface KerberosConfig {
  serviceAccount: string;
  keytabPath: string;
  realm: string;
  kdc: string;
}

export interface SQLConfig {
  server: string;
  database: string;
  options: {
    trustedConnection: boolean;
    enableArithAbort: boolean;
    [key: string]: unknown;
  };
}

export interface JWTPayload {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

export interface ValidationContext {
  expectedIssuer: string;
  expectedAudiences: string[];
  clockTolerance: number;
  maxTokenAge?: number;
}

export interface DelegationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  auditTrail: AuditEntry;
}

export interface AuditEntry {
  timestamp: Date;
  userId: string;
  legacyUsername?: string;
  action: string;
  resource: string;
  success: boolean;
  error?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SecurityError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

// Extend FastMCP types
declare module 'fastmcp' {
  interface SessionContext {
    session?: UserSession;
    auditTrail?: AuditEntry[];
  }

  interface FastMCPRequestContext {
    session?: UserSession;
  }
}

export type DelegationType = 'kerberos' | 'sql';

export interface DelegationModule {
  type: DelegationType;
  delegate<T>(
    legacyUsername: string,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<DelegationResult<T>>;
  validateAccess(context: UserSession): Promise<boolean>;
}