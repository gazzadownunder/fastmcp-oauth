# **Enhancements and Refinements**

This document tracks improvements made to the core architecture plan (refactor.md) to address ambiguities and implement advanced security features required for enterprise and conversational client deployment.

## **E-001: Auditing and Session Management Finalization**

These changes formalize the handling of cross-cutting concerns (Session Management and Auditing), providing clear contracts and dependency rules.

| ID | Description | Resolution |
| :---- | :---- | :---- |
| **E-001a** | **Session Responsibility:** Clearly define the roles of JWTValidator, RoleMapper, and SessionManager. | **Status: Finalized.** Defined clear, separate responsibilities. |
| **E-001b** | **Role Mapping Failure Policy:** Define system behavior when JWT roles cannot be mapped to internal system roles (critical security edge case). | **Status: Finalized.** The RoleMapper must **never fail fatally**. It assigns the **"Unassigned" role** and returns an auditEntry. The AuthenticationService rejects the session based on the "Unassigned" role's lack of permissions. |
| **E-001c** | **Audit Service Implementation:** Define how the centralized AuditService is managed and used by components without creating tight coupling. | **Status: Finalized.** The AuditService is injected into the **CoreContext**. Delegation modules only return the auditTrail in their result; the MCPOAuthServer handles persistence. Implemented the **Null Object Pattern** to prevent crashes if the audit sink is unavailable. |

## **E-002: Dependency Management and Scoping**

These changes ensure the architecture scales easily by enforcing strict rules for how services are accessed and utilized.

| ID | Description | Resolution |
| :---- | :---- | :---- |
| **E-002a** | **Configuration Flow:** Clarify the roles of the ConfigManager and MCPOAuthServer in distributing configuration. | **Status: Finalized.** ConfigManager loads/validates the unified config; MCPOAuthServer orchestrator extracts and passes the correct *subset* to each component (e.g., only auth config to AuthenticationService). |
| **E-002b** | **Tool Factory Dependency Scoping:** Prevent boilerplate when introducing new shared services (e.g., Rate Limiter). | **Status: Finalized.** The MCPOAuthServer instantiates all shared services into a single **CoreContext** object. All **Tool Factories** are updated to accept and use the entire CoreContext, making future dependency additions simple. |

## **E-003: Dynamic Tool Visibility (Contextual Access)**

This change implements dynamic tool listing using the existing fastmcp Contextual Access (CA) mechanism, eliminating the need for a custom hook and ensuring a clean user experience.

| ID | Description | Resolution |
| :---- | :---- | :---- |
| **E-003a** | **Dynamic Tool Visibility:** Implement session-based tool listing to prevent unauthorized users from seeing tools. | **Status: Finalized.** Leverages the existing fastmcp **Contextual Access (CA)** feature. Tool Factories now return both the tool definition and an explicit **accessCheck** function (the CA method). |
| **E-003b** | **CA Implementation:** Define the content of the accessCheck function. | **Status: Finalized.** The accessCheck function uses the framework's **Authorization.hasRole(session, role)** helper to return a simple true/false boolean to fastmcp, determining visibility. |

## **E-004: Conversational Client Experience (LLM Support)**

This implements a security feature required specifically for conversational (LLM) clients to ensure graceful error handling.

| ID | Description | Resolution |
| :---- | :---- | :---- |
| **E-004a** | **LLM-Friendly Error Handling:** Prevent security exceptions from breaking the LLM client experience. | **Status: Finalized.** The Tool Factory now wraps the execution handler in a try...catch. It catches the internal INSUFFICIENT\_PERMISSIONS error thrown by **Authorization.requireRole()** and converts it into a standardized, predictable **JSON failure object** for the LLM to process and convey politely to the end-user. |
| **E-004b** | **Enforcement Split:** Clarify the two tiers of authorization. | **Status: Finalized.** **Visibility** check (CA method) uses Authorization.hasRole() (soft fail). **Execution** check (inside handler) uses Authorization.requireRole() (hard throw). |

