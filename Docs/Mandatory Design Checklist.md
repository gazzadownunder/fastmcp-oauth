# **Mandatory Design Checklist (Pre-Implementation)**

This document outlines the final, critical changes required to ensure architectural integrity, maximum security enforcement, and production safety, based on the comprehensive design review. These actions supersede all prior planning notes regarding the affected components.

## **1\. Architectural Integrity & Typing**

These changes enforce the One-Way Dependency Flow rule and guarantee runtime type safety across the crucial Core and MCP layers.

| Component | File Path | Action Required | Source Gap |
| :---- | :---- | :---- | :---- |
| **CoreContextValidator** | src/core/validators.ts (New File) | **RELOCATE:** Move the CoreContextValidator definition and implementation from src/mcp/types.ts to src/core/validators.ts. This ensures the Core logic remains free of MCP layer dependencies. | **Architecture Integrity** |
| **MCPOAuthServer** | src/mcp/server.ts | **VALIDATION TIMING:** Move the call to CoreContextValidator.validate(this.coreContext) from the constructor to the **async start()** method. Validation must occur only after all services have been fully initialized. | **Production Safety (GAP \#8)** |
| **Tool Handler Types** | src/mcp/types.ts | **TYPE SAFETY:** Define the **MCPContext** interface (including session: UserSession) and the generic **ToolHandler\<P, R\>** type to enforce compile-time type safety for all tool definitions. | **Type Safety (GAP \#12)** |
| **CoreContext Assembly** | src/mcp/server.ts | **TYPE ENFORCEMENT:** When assembling this.coreContext, use the TypeScript **satisfies CoreContext** operator to ensure the dependency object matches the required contract at compile time. | **Type Safety (GAP \#11)** |

## **2\. Security and Enforcement**

These changes close critical security gaps related to integrity, permissions, and session validation.

| Component | File Path | Action Required | Source Gap |
| :---- | :---- | :---- | :---- |
| **UserSession** | src/core/types.ts | **MIGRATION & VERSIONING:** Add a private **\_version: number** field to the UserSession interface. This enables future backward-compatible schema migrations. | **Production Safety (GAP \#6)** |
| **SessionManager** | src/core/session-manager.ts | **CRITICAL ASSERTION:** Update createSession() to perform a runtime assertion: **If role \=== UNASSIGNED\_ROLE, explicitly throw an error if permissions are not empty.** This strictly enforces the denial-by-default policy. | **Security (GAP \#2)** |
| **AuditEntry** | src/core/types.ts | **INTEGRITY TRACKING:** Add a mandatory **source: string** field (e.g., 'delegation:sql', 'auth:mapper') to the AuditEntry interface to track and validate the origin of all security logs. | **Security (GAP \#3)** |
| **AuditService** | src/core/audit-service.ts | **OVERFLOW POLICY:** Implement an optional **onOverflow?: (entries: AuditEntry\[\]) \=\> void** callback in the AuditService constructor (or its storage implementation) to allow the consumer to flush critical audit data to persistent storage instead of silently discarding it when the in-memory buffer limit is reached. | **Production Safety (GAP \#7)** |
| **DelegationRegistry** | src/delegation/registry.ts | **AUDIT SOURCE:** Ensure the delegate() method mandates that the auditTrail returned by any delegation module includes the module's name in its source field. | **Security (GAP \#3)** |

## **3\. Production Hardening and LLM Experience**

These changes ensure the framework is robust, scalable, and provides a conversational client (LLM) with a smooth, predictable experience.

| Component | File Path | Action Required | Source Gap |
| :---- | :---- | :---- | :---- |
| **Tool Execution** | src/mcp/tools/\*.ts | **FULL ERROR HANDLING:** Update the try...catch wrapper in all tool factories to catch **all** types of OAuthSecurityError (including UNAUTHENTICATED, DELEGATION\_ERROR, and INVALID\_INPUT), not just INSUFFICIENT\_PERMISSIONS. | **LLM UX (GAP \#4)** |
| **Error Types** | src/mcp/types.ts | **SUCCESS SCHEMA:** Define the **LLMSuccessResponse** interface ({ status: 'success', data: any }) to standardize successful tool output. The tool handler must return either this schema or the LLMFailureResponse schema. | **LLM UX (GAP \#5)** |
| **MCPAuthMiddleware** | src/mcp/middleware.ts | **RUNTIME REJECTION:** Update the middleware to check the new **session.rejected** field on every subsequent request. If true, the middleware must immediately throw a 403 error, closing the role-revocation timing gap. | **Security (GAP \#1)** |

### **Conclusion: Final Steps**

With these points added to the implementation plan, the architecture is ready to move into the coding phase, having addressed all known security and architectural integrity concerns.