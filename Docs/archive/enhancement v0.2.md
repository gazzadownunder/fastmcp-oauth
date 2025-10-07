# **Modular Architecture Refactoring Plan**

## **Executive Summary**

Refactor the monolithic OAuth OBO server into a layered, modular architecture that separates core authentication from MCP integration and delegation modules. This enables the framework to be used standalone, with custom delegation strategies, and in non-MCP contexts, while implementing defense-in-depth security and enhanced LLM-friendly error handling.

## **Current Architecture Issues**

### **Problems**

1. **Tight Coupling**: OAuthOBOServer directly manages SQL delegation \- no separation of concerns  
2. **Monolithic Design**: Core authentication is mixed with MCP integration and delegation logic  
3. **No Plugin System**: Cannot easily add/remove delegation modules without modifying core  
4. **Tool Coupling**: Tools are hardcoded in server class, not modular or extensible  
5. **Reusability**: Cannot use authentication framework without FastMCP dependency

### **Current File Structure**

src/  
├── middleware/  
│   └── jwt-validator.ts      \# JWT validation (coupled with role mapping)  
├── services/  
│   └── sql-delegator.ts      \# SQL delegation (tightly coupled)  
├── config/  
│   ├── manager.ts  
│   └── schema.ts             \# Monolithic config schema  
├── types/  
│   └── index.ts              \# Mixed types  
├── utils/  
│   └── errors.ts  
├── index.ts                  \# Exports everything  
└── index-simple.ts           \# MCP server (monolithic)

## **Target Architecture**

### **Design Goals**

1. **Layered Architecture**: Core → Delegation → MCP Integration  
2. **Separation of Concerns**: Authentication, authorization, delegation are separate  
3. **Pluggable Modules**: Easy to add/remove delegation strategies  
4. **Framework Flexibility**: Use auth without delegation, delegation without MCP, etc.  
5. **Backward Compatible**: Existing code continues to work with adapters  
6. **Defense-in-Depth**: Implement two-tier authorization (Visibility/Execution).

### **Architectural Rule (New)**

**One-Way Dependency Flow:** Core  Delegation  MCP. Files in src/core/ **must not** import anything from src/delegation/ or src/mcp/.

### **Target File Structure**

src/  
├── core/                     \# 🆕 Core Authentication Framework (standalone)  
│   ├── jwt-validator.ts      \# JWT validation only  
│   ├── role-mapper.ts        \# Role mapping logic  
│   ├── authentication-service.ts  \# Main auth API  
│   ├── session-manager.ts    \# Session lifecycle & migration (NEW)  
│   ├── audit-service.ts      \# Centralized logging (NEW)  
│   ├── types.ts              \# Core types only  
│   └── index.ts              \# Clean public API  
│  
├── delegation/               \# 🆕 Delegation Module System  
│   ├── base.ts               \# DelegationModule interface  
│   ├── registry.ts           \# DelegationRegistry (plugin manager)  
│   ├── types.ts              \# Delegation types  
│   ├── sql/                  \# SQL Module (refactored)  
│   │   ├── sql-module.ts     \# Implements DelegationModule  
│   │   ├── sql-delegator.ts  \# Core SQL logic  
│   │   ├── types.ts          \# SQL-specific types  
│   │   └── index.ts          \# SQL module exports  
│   ├── kerberos/             \# Kerberos Module (placeholder)  
│   │   ├── kerberos-module.ts  
│   │   ├── types.ts  
│   │   └── index.ts  
│   └── index.ts              \# Delegation exports  
│  
├── mcp/                      \# 🆕 MCP Integration Layer  
│   ├── middleware.ts         \# FastMCP auth middleware  
│   ├── authorization.ts      \# Role/permission helpers  
│   ├── server.ts             \# FastMCP server orchestration  
│   ├── types.ts              \# MCP-specific types (incl. LLM/Tool types) (NEW)  
│   ├── tools/                \# MCP Tools (refactored \- use factories)  
│   │   ├── health-check.ts  
│   │   ├── user-info.ts  
│   │   ├── audit-log.ts  
│   │   └── index.ts  
│   └── index.ts              \# MCP exports  
│  
\# ... (Other files remain the same)

## **Implementation Phases (Revised)**

### **Phase 0: Pre-Migration Discovery (New)**

| Task | Detail | Status |
| :---- | :---- | :---- |
| **0.1 Verify FastMCP CA** | Verify the existence and signature of the fastmcp **Contextual Access (CA)** method (e.g., canAccess property on addTool). | **Action:** Requires confirmation. If missing, revert to execution-only security. |
| **0.2 Define Core Context Schema** | Define the required keys for the CoreContext dependency container (authService, auditService, delegationRegistry, etc.). | **Action:** Implement CoreContext type and CoreContext.validate() method for runtime checks. |

### **Phase 1: Core Authentication Framework (Standalone)**

#### **1.1 Update Core Types and Contracts (src/core/types.ts)**

* **Add UNASSIGNED\_ROLE Policy:** Define permissions for the unassigned role.  
* **Add Session Migration:** Define the structure for session migration.

export interface UserSession {  
  // ... existing fields ...  
  permissions: string\[\];  
}  
// Policy: The UNASSIGNED\_ROLE must have permissions: \[\] to explicitly deny all access.

#### **1.5 Create Session Manager (src/core/session-manager.ts)**

export class SessionManager {  
  // ... existing methods ...  
    
  // NEW: Support migration for existing serialized sessions  
  migrateSession(rawSession: any): UserSession;   
}

### **Phase 2: Delegation Module System**

#### **2.2 Create Delegation Registry (src/delegation/registry.ts)**

* **Add Delegation Execution Method:** Simplifies tool usage by providing a centralized execution facade.

export class DelegationRegistry {  
  // ... existing methods ...  
    
  // NEW: Executes delegation by looking up the module and calling its delegate method.  
  async delegate\<T\>(name: string, session: UserSession, action: string, params: any): Promise\<DelegationResult\<T\>\>;  
}

### **Phase 3: MCP Integration Layer**

#### **3.1 Create MCP Types (src/mcp/types.ts) (New)**

* **Standardize LLM Error Response:** Ensures consistent error handling for conversational clients.  
* **Standardize Tool Registration:** Formalize the return type of the Tool Factory, including the CA function.

export interface LLMFailureResponse {  
    status: 'failure';  
    code: 'INSUFFICIENT\_PERMISSIONS' | 'DELEGATION\_ERROR' | 'INVALID\_INPUT' | string;  
    message: string; // Human-readable refusal  
}

export interface ToolRegistration {  
    name: string;  
    schema: z.ZodObject\<any\>;  
    handler: (params: any, context: any) \=\> Promise\<any\>;  
    // NEW: Contextual Access (CA) method for dynamic visibility  
    accessCheck?: (context: FastMCPRequestContext) \=\> boolean;   
}

export interface CoreContext {  
    // Requires validation at runtime to ensure all keys are present (Task 0.2)  
    authService: AuthenticationService;  
    auditService: AuditService;  
    delegationRegistry: DelegationRegistry;  
    // ... other services  
}

#### **3.4 Create MCP Server Orchestration (src/mcp/server.ts)**

* **Context Validation:** Implement runtime check on the assembled CoreContext.

// MCPOAuthServer.start() implementation:  
// 1\. Build CoreContext  
// 2\. CoreContext.validate(this.context); // Check if all services are present  
// 3\. Register tools using the ToolRegistration interface, passing the accessCheck function.

## **Risks & Mitigations (Updated)**

| Risk | Impact | Mitigation |
| :---- | :---- | :---- |
| **Circular dependency** (Core  MCP) | High | **NEW POLICY:** Enforce the **One-Way Dependency Flow: Core  Delegation  MCP**. Use linting rules to enforce no imports from delegation/ or mcp/ within core/. |
| **Rollback failure** (Mid-refactor instability) | Critical | **NEW POLICY:** Implement a simple **Feature Branch Isolation** strategy. Development must occur on a dedicated branch (feature/v2-refactor). Rollback involves deleting the branch and deploying the last stable release tag. |
| **FastMCP CA API Missing** (Design block) | High | **NEW TASK (Phase 0):** Implement a dedicated discovery task to verify the API signature. If missing, revert visibility filtering to rely solely on **Execution-Level Security** (Authorization.requireRole). |
| **Audit Service performance** (O(n) queries) | Medium | **NEW POLICY:** The AuditService will be constrained. It will **only expose writing methods** (log(...)). Any querying must be backed by an indexed persistence layer, preventing O(n) operations on large, in-memory arrays. |
| **CoreContext Misconfiguration** (Runtime errors) | Medium | **NEW TASK (Phase 0):** Implement a **CoreContext.validate()** method to perform strict runtime checks on all required dependencies before the server starts. |
| **Existing Session Migration** (Production risk) | High | **NEW METHOD:** Implement SessionManager.migrateSession(rawSession) to ensure backward compatibility for old serialized sessions, preventing crashes upon deserialization. |
| **Type Inconsistency** (LLM/Tool interfaces) | Medium | **NEW INTERFACES:** Formalize LLMFailureResponse and ToolRegistration interfaces in src/mcp/types.ts to enforce consistency at the module boundary. |

