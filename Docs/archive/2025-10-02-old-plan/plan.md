# FastMCP OAuth On-Behalf-Of (OBO) Implementation Plan

## Project Overview
Extend the fastMCP TypeScript framework to support on-behalf-of authentication with JWT validation, Kerberos constrained delegation, and SQL impersonation for legacy platform integration.

## Implementation Status: ✅ PHASE 1-4 COMPLETED

### Completed Components
- ✅ **Phase 1**: Foundation & Setup - Project scaffolding, configuration framework
- ✅ **Phase 2**: JWT Middleware - Jose library integration, RFC 8725 compliance
- ✅ **Phase 3**: SQL Delegation - EXECUTE AS USER implementation
- ✅ **Phase 4**: FastMCP Integration - Tool framework and authentication
- 🔄 **Phase 5**: Testing - Basic test suite implemented
- 📝 **Phase 6**: Documentation - README and core documentation complete

## Phase 1: Foundation & Setup (2-3 weeks) ✅ COMPLETED

### 1.1 Project Scaffolding ✅
- ✅ Set up TypeScript project with Node.js 22.14.0
- ✅ Initialized project structure with security-focused architecture
- ✅ Configured build tools: tsup, vitest, eslint, prettier
- ✅ Created comprehensive directory structure (src/, tests/, docs/)

### 1.2 Configuration Management System ✅
- ✅ Designed secure configuration structure with Zod validation
- ✅ Implemented ConfigManager class with hot-reload capability
- ✅ Created comprehensive configuration schema:
  - ✅ Trusted IDP endpoints with HTTPS validation
  - ✅ JWT claim mappings with type safety
  - ✅ SQL Server configuration with security options
  - ✅ Rate limiting and audit configuration
- ✅ Environment-based configuration loading with validation
- ✅ Schema enforcement with runtime type checking

### 1.3 Security Framework ✅
- ✅ Established comprehensive audit trail system (AuditEntry interface)
- ✅ Implemented secure error handling (OAuthSecurityError class)
- ✅ Created sanitized error responses for production
- ✅ Environment variable management with validation

## Security Requirements & Compliance

### JWT Security (RFC 8725 Compliance)
- **Mandatory Algorithm Allowlisting**: Only RS256, ES256 permitted
- **Strict Claims Validation**: iss, aud, exp, nbf validation required
- **Key Management**: Cryptographically secure key generation and rotation
- **Token Lifecycle**: 15-60 minute access token lifetime
- **Zero Algorithm Confusion**: Explicit algorithm validation against key type

### RFC 8414 OAuth Authorization Server Metadata
- **Discovery Endpoint**: /.well-known/oauth-authorization-server implementation
- **Required Metadata**: issuer, authorization_endpoint, token_endpoint, jwks_uri
- **TLS Requirements**: TLS 1.2+ mandatory, TLS 1.3 recommended
- **Certificate Validation**: Full server certificate validation chain
- **Multi-IDP Support**: Dynamic metadata validation and caching

## Phase 2: Core Authentication & JWT Middleware (3-4 weeks)

### 2.1 Security-Focused JWT Validation Middleware ✅
- **Jose Library Integration**: Implement RFC 8725 compliant validation
- **Multi-IDP Discovery**: RFC 8414 metadata endpoint integration
- **Algorithm Security**: Explicit allowlist (RS256, ES256 only)
- **JWKS Endpoint Validation**: Secure key retrieval with caching
- **Comprehensive Claims Validation**:
  - Issuer (iss) validation against trusted IDP list
  - Audience (aud) validation for API protection
  - Expiration (exp) and not-before (nbf) validation
  - Custom claim extraction with type safety
- **Security Headers**: Proper error responses without information leakage

### 2.2 Request Context Enhancement ✅
- ✅ Attached validated user information to FastMCP request pipeline
- ✅ Implemented UserSession interface with comprehensive user context
- ✅ Added tool-specific authorization through canAccess methods

### 2.3 Error Handling & Security ✅
- ✅ Implemented proper HTTP status codes (401, 403, 429, 500)
- ✅ Created OAuthSecurityError with code-based error handling
- ✅ Comprehensive audit logging with AuditEntry tracking
- ✅ Rate limiting infrastructure (validateWithRateLimit method)

### 2.4 Security Implementation Patterns ✅
- **JWT Validation Pipeline**: Multi-stage validation with fail-fast approach
- **Security Error Handling**: Prevent information leakage in error responses
- **Token Caching**: Secure in-memory caching with encryption
- **JWKS Caching**: TTL-based key caching with secure refresh
- **Audit Logging**: Comprehensive security event logging
- **Rate Limiting**: Per-client and global rate limiting implementation

## Phase 3: Delegation Modules (4-6 weeks)

### 3.1 Kerberos Delegation Module 🔄 PLANNED
- 📝 Kerberos library installed (npm package ready)
- 🔄 KerberosDelegator class structure defined
- 📝 Configuration schema includes Kerberos settings
- ⏳ S4U2Self/S4U2Proxy implementation pending
  - Requires additional research for Node.js implementation
  - Limited documentation for constrained delegation in JavaScript

### 3.2 SQL Delegation Module ✅ COMPLETED
- ✅ Created SQLDelegator class using mssql library with TypeScript
- ✅ Implemented secure EXECUTE AS USER functionality:
  - ✅ Parameterized query construction with type-safe parameters
  - ✅ Context impersonation with automatic reversion on error
  - ✅ Connection pooling with configurable settings
  - ✅ Comprehensive SQL injection prevention:
    - ✅ Identifier validation (isValidSQLIdentifier)
    - ✅ Dangerous operation blocking (DROP, CREATE, xp_cmdshell, etc.)
    - ✅ Nested EXECUTE AS prevention
- ✅ Support for queries, stored procedures, and functions
- ✅ Health check implementation for monitoring

### 3.3 Cross-Platform Kerberos Support
- Configure Linux-based Kerberos client integration
- Set up krb5.conf management for non-Windows deployments
- Test delegation across Windows/Linux environments

## Phase 4: Tool Integration & MCP Enhancement (3-4 weeks)

### 4.1 FastMCP OAuth 2.1 Integration ✅
- **Extend Existing OAuth Support**: Build on fastMCP's RFC 8414 compliance
- **Resource Server Configuration**: OAuth 2.1 protected resource metadata
- **Dynamic Client Registration**: Support for Claude Desktop integration
- **Session Context Enhancement**: Map JWT claims to fastMCP UserSession
- **Tool-Level Authorization**: Claim-based access control integration
- **Delegation Module Integration**: Add delegation to tool execution pipeline

### 4.2 Multi-Claim Support ✅
- ✅ Implemented per-tool claim validation
- ✅ Scope-based authorization through UserSession
- ✅ Flexible claim mapping configuration per IDP

### 4.3 Enhanced Tool Framework ✅
- ✅ Created comprehensive tool set:
  - ✅ sql-delegate: SQL operations with EXECUTE AS USER
  - ✅ health-check: Service health monitoring
  - ✅ user-info: Session information retrieval
  - ✅ audit-log: Admin-only audit trail access
- ✅ Tool-level error handling with proper status codes
- ✅ Complete audit trail for all tool executions

## Phase 5: Testing & Security Hardening (3-4 weeks)

### 5.1 Security-Focused Testing Suite ✅ BASIC IMPLEMENTATION
- **JWT Security Testing**: RFC 8725 compliance validation
- **Algorithm Confusion Tests**: Prevent algorithm downgrade attacks
- **Token Manipulation Tests**: Invalid signature, expired token, tampered payload
- **JWKS Security Tests**: Key rotation, malformed keys, unreachable endpoints
- **Claims Validation Tests**: Missing claims, invalid issuer/audience
- **Multi-IDP Testing**: Cross-IDP validation and isolation testing
- **Integration Tests**: End-to-end JWT → Legacy platform flows
- **Load Testing**: Delegation performance under concurrent load
- **Cross-platform Compatibility**: Windows/Linux deployment validation

### 5.2 Enhanced Security Audit
- **RFC 8725 Compliance Audit**: Complete JWT security best practices review
- **RFC 8414 Metadata Validation**: Discovery endpoint security assessment
- **Key Management Audit**: JWKS endpoint security and key lifecycle review
- **Multi-IDP Security**: Cross-tenant isolation and claim validation testing
- **Kerberos Delegation Review**: S4U2Self/S4U2Proxy security configuration
- **SQL Injection Testing**: EXECUTE AS USER privilege escalation prevention
- **Service Account Audit**: Privilege minimization and rotation procedures

### 5.3 Performance Optimization
- JWT validation caching strategies
- Kerberos ticket caching and renewal
- SQL connection pool optimization
- Memory and CPU profiling

## Phase 6: Documentation & Deployment (2-3 weeks)

### 6.1 Technical Documentation
- API documentation for new authentication endpoints
- Configuration guide for IDP integration
- Kerberos and SQL delegation setup instructions
- Security best practices and deployment guide

### 6.2 Operational Documentation
- Monitoring and alerting setup guides
- Troubleshooting documentation
- Performance tuning recommendations
- Disaster recovery procedures

### 6.3 Deployment Preparation
- Container deployment configurations
- Environment-specific configuration templates
- Security scanning and compliance validation
- Production readiness checklist

## Key Deliverables

1. **Extended FastMCP Framework** with OBO authentication
2. **JWT Validation Middleware** with multi-IDP support
3. **Kerberos Delegation Module** for Windows/Linux environments
4. **SQL Impersonation Module** with security controls
5. **Comprehensive Test Suite** with security focus
6. **Production Deployment Package** with documentation
7. **Security Audit Report** with compliance validation

## Implementation Timeline

| Phase | Duration | Key Milestones |
|-------|----------|----------------|
| Phase 1 | 2-3 weeks | Project setup, configuration framework |
| Phase 2 | 3-4 weeks | JWT middleware, authentication pipeline |
| Phase 3 | 4-6 weeks | Kerberos & SQL delegation modules |
| Phase 4 | 3-4 weeks | FastMCP integration, tool enhancement |
| Phase 5 | 3-4 weeks | Testing, security hardening |
| Phase 6 | 2-3 weeks | Documentation, deployment preparation |
| **Total** | **17-24 weeks** | **Production-ready OBO framework** |

## Technical Architecture

### Core Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   External IDP  │────│  JWT Middleware │────│   FastMCP Core  │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                │                        │
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Kerberos Module │    │   SQL Module    │
                       │                 │    │                 │
                       └─────────────────┘    └─────────────────┘
                                │                        │
                                │                        │
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Legacy Windows  │    │  SQL Server DB  │
                       │   Platforms     │    │                 │
                       └─────────────────┘    └─────────────────┘
```

### Security Layers

1. **JWT Validation Layer**: Token signature, claims, expiration validation
2. **Authorization Layer**: Scope and role-based access control
3. **Delegation Layer**: Constrained delegation with minimal privileges
4. **Audit Layer**: Comprehensive logging and monitoring

## Risk Mitigation

- **Security**: Implement defense-in-depth with multiple validation layers
- **Performance**: Add caching and connection pooling throughout
- **Compatibility**: Test across multiple OS and legacy platform versions
- **Compliance**: Include audit trails and access logging for all operations

## Success Criteria

- JWT validation with sub-100ms response times
- Successful Kerberos delegation to legacy Windows platforms
- Secure SQL impersonation with full audit trails
- Zero security vulnerabilities in penetration testing
- Cross-platform deployment capability (Windows/Linux)
- Comprehensive documentation and operational guides

## Dependencies

### External Libraries (ACTUAL IMPLEMENTATION)
- ✅ `jose` v6.1.0+ - RFC 8725 compliant JWT validation
- ✅ `mssql` v11.0.1 - SQL Server connectivity with TypeScript types
- ✅ `kerberos` v2.2.2 - Cross-platform Kerberos support (installed)
- ✅ `fastmcp` v1.0.0 - Base MCP framework
- ✅ `zod` v3.25.76 - Runtime type validation
- ✅ `vitest` v2.0.0 - Modern testing framework
- ✅ `tsup` - Fast TypeScript bundler
- ✅ `undici` v7.13.0 - HTTP client

### System Requirements
- Node.js 18+
- TypeScript 5+
- Kerberos client libraries (krb5-workstation on Linux)
- Active Directory domain for Kerberos delegation
- SQL Server with Windows Authentication support

## Configuration Examples

### IDP Configuration
```json
{
  "trustedIDPs": [
    {
      "issuer": "https://auth.company.com",
      "discoveryUrl": "https://auth.company.com/.well-known/oauth-authorization-server",
      "jwksUri": "https://auth.company.com/.well-known/jwks.json",
      "audience": "mcp-server-api",
      "algorithms": ["RS256", "ES256"],
      "claimMappings": {
        "legacyUsername": "legacy_sam_account",
        "roles": "user_roles",
        "scopes": "authorized_scopes"
      },
      "security": {
        "clockTolerance": 60,
        "maxTokenAge": 3600,
        "requireNbf": true
      }
    }
  ],
  "rateLimiting": {
    "maxRequests": 100,
    "windowMs": 900000
  },
  "audit": {
    "logAllAttempts": true,
    "logFailedAttempts": true,
    "retentionDays": 90
  }
}
```

### Kerberos Configuration
```json
{
  "kerberos": {
    "serviceAccount": "svc-mcp-delegation@domain.com",
    "keytabPath": "/etc/mcp/delegation.keytab",
    "realm": "COMPANY.COM",
    "kdc": "dc01.company.com"
  }
}
```

### SQL Configuration
```json
{
  "sql": {
    "server": "sql01.company.com",
    "database": "legacy_app",
    "options": {
      "trustedConnection": true,
      "enableArithAbort": true
    }
  }
}
```

## Monitoring & Observability

### Key Metrics
- JWT validation success/failure rates
- Kerberos delegation latency and success rates
- SQL impersonation performance metrics
- Error rates by delegation type
- Security audit event volumes

### Alerting Thresholds
- Authentication failure rate > 5%
- Delegation latency > 500ms
- Any privilege escalation attempts
- Configuration changes
- Service account lockouts

## Compliance Considerations

### Security Standards
- OWASP Top 10 compliance
- JWT security best practices (RFC 8725)
- Kerberos security guidelines
- SQL Server security baseline

### Audit Requirements
- All authentication attempts logged
- Delegation activities tracked with user context
- Configuration changes audited
- Failed access attempts investigated
- Periodic security reviews scheduled

## Production Security Checklist

### Pre-Deployment Security Validation
- [x] All JWT validation uses jose library v6.1.0+
- [x] Only RS256/ES256 algorithms permitted in configuration
- [x] RFC 8414 discovery endpoints designed and configured
- [x] JWKS endpoints use HTTPS with proper certificate validation
- [x] Token expiration times set to maximum 60 minutes (3600s)
- [x] Rate limiting infrastructure implemented
- [x] Comprehensive audit logging implemented
- [x] Error responses sanitized for production
- [x] Multi-IDP configuration support implemented
- [ ] Security scanning completed with zero critical findings

### Operational Security Requirements
- [ ] Key rotation procedures documented and tested
- [x] Security monitoring via health-check tool
- [x] Audit trail system implemented and tested
- [ ] Incident response procedures documented
- [ ] Regular security assessments scheduled
- [x] Compliance audit trails implemented

## Implementation Details

### Project Structure Created
```
src/
├── config/          # Configuration management with Zod validation
│   ├── manager.ts   # ConfigManager class
│   ├── schema.ts    # Zod schemas for validation
│   └── example.json # Configuration template
├── middleware/      # Authentication middleware
│   └── jwt-validator.ts # JWT validation with jose
├── services/        # Delegation services
│   └── sql-delegator.ts # SQL EXECUTE AS USER
├── types/          # TypeScript interfaces
│   └── index.ts    # Core type definitions
├── utils/          # Utility functions
│   └── errors.ts   # Security error handling
├── examples/       # Usage examples
│   └── basic-server.ts # Server startup example
├── index.ts        # Main server implementation
└── index-simple.ts # Simplified FastMCP integration

tests/
├── unit/           # Unit tests
│   └── jwt-validator.test.ts
└── integration/    # Integration tests
    └── basic-functionality.test.ts
```

### Key Implementation Achievements

1. **Security-First Design**
   - All HTTP endpoints require HTTPS
   - Algorithms explicitly allowlisted (no 'none' algorithm)
   - Comprehensive input validation at every layer
   - SQL injection prevention with multiple safeguards

2. **FastMCP Integration**
   - Seamless authentication through FastMCP authenticate function
   - Tool-level access control with session context
   - Comprehensive audit logging for all operations

3. **Production Readiness**
   - Error sanitization for production environments
   - Health monitoring and service status checks
   - Configurable logging and audit retention
   - Docker-ready deployment structure

4. **Testing Coverage**
   - Configuration validation tests
   - JWT security validation tests
   - SQL injection prevention tests
   - Integration tests for server functionality

### Next Steps for Full Production

1. **Kerberos S4U Implementation** (High Complexity)
   - Research Node.js S4U2Self/S4U2Proxy implementation
   - Test cross-platform compatibility
   - Implement ticket caching and renewal

2. **Enhanced Monitoring**
   - Integrate with enterprise SIEM systems
   - Add Prometheus/Grafana metrics
   - Implement distributed tracing

3. **Performance Optimization**
   - Implement Redis for JWT caching
   - Add connection pool tuning
   - Optimize JWKS refresh strategy

4. **Additional Security Hardening**
   - Add mutual TLS support
   - Implement key rotation automation
   - Add penetration testing suite