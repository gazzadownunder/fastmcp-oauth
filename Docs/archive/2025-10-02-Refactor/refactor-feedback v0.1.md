# **Supplementary Action Plan: Addressing Feedback Gaps**

This action plan clarifies the identified points of ambiguity in the refactoring proposal, ensuring a seamless implementation of cross-cutting concerns like session management, auditing, configuration flow, and dynamic tool registration.

## **Task 1: Clarify Session Management Responsibility**

**Gap:** Ambiguity regarding the precise component responsible for the full session lifecycle (create, validate, refresh).

**Resolution:** Formalize the responsibilities within the Core Layer (Phase 1).

| Component | Responsibility | Phase |
| :---- | :---- | :---- |
| **JWTValidator** (src/core/jwt-validator.ts) | Validation of token signature, expiry, and extraction of **raw claims**. | Phase 1 |
| **RoleMapper** (src/core/role-mapper.ts) | Transformation of raw claims/roles into a standardized **primary role** and customRoles. | Phase 1 |
| **SessionManager** (src/core/session-manager.ts) | Orchestrates claim/role data to **construct, validate, and refresh** the structured UserSession object. It handles the session contract. | Phase 1 |
| **AuthenticationService** (src/core/authentication-service.ts) | The primary public API for consumers. It **orchestrates** the Validator, Mapper, and Manager to produce the final AuthenticationResult (Session \+ Audit Entry). | Phase 1 |

**Action Item:** Update the JSDoc and internal logic of SessionManager and AuthenticationService to clearly document this separation.

## **Task 2: Implement Centralized Auditing Mechanism**

**Gap:** The plan mentions auditEntry in various results but lacks a central service to consume and persist these entries.

**Resolution:** Introduce an injectable AuditService in the Core Layer to handle all logging requests across the architecture.

1. **Create AuditService:** Implement a new service in src/core/audit-service.ts.  
   * It will expose a method like log(entry: AuditEntry) and be configured with the persistence sink (e.g., file, database, third-party log system).  
2. **Inject in Core:** AuthenticationService will be initialized with, or internally create, the AuditService. Upon successful or failed authentication, it will immediately call this.auditService.log(newAuthEntry).  
3. **Inject in Delegation:** The MCPOAuthServer (orchestration layer) will pass the AuditService instance (or a reference to it) to the DelegationModule upon registration/initialization.  
4. **Log Delegation Events:** When a delegation module successfully completes its task, it will log its internal auditTrail using the shared AuditService instance.

**Action Item:**

* **Phase 1:** Create src/core/audit-service.ts and integrate it into AuthenticationService.  
* **Phase 2:** Ensure the DelegationModule.initialize() or a corresponding setup step receives the AuditService instance.

## **Task 3: Formalize Modular Configuration Flow**

**Gap:** Clarify how the configuration is loaded modularly and passed down through the layers.

**Resolution:** Define the single responsibility of the ConfigManager and the Orchestration Layer (MCPOAuthServer).

1. **ConfigManager Responsibility:** The manager (src/config/manager.ts) is only responsible for **loading the unified configuration object** from the file system and **validating it** against the UnifiedConfigSchema. It exposes typed getters for each layer (e.g., getAuthConfig(), getDelegationConfig()).  
2. **Orchestrator Responsibility:** The MCPOAuthServer acts as the orchestrator and is responsible for passing the correct configuration subset to the correct component during initialization.  
   * It passes the Core configuration (config.auth) to the AuthenticationService.  
   * It passes the specific module configuration (e.g., config.delegation.sql) only to the instantiated SQLDelegationModule.initialize().

**Action Item:** Ensure the MCPOAuthServer constructor and the registerDelegationModule method in src/mcp/server.ts explicitly demonstrate this configuration subsetting pattern.

## **Task 4: Define Dynamic Tool Registration**

**Gap:** The current plan implies the MCP tools are imported directly, which couples the orchestration layer to the available tools.

**Resolution:** Switch to a **Tool Factory** pattern for true dynamic loading.

1. **Define ToolFactory:** Introduce a ToolFactory type in src/mcp/types.ts. This factory is a function that takes required dependencies (e.g., DelegationRegistry, AuditService) and returns a configured tool object.  
   export type ToolFactory \= (dependencies: {  
       registry: DelegationRegistry;  
       auditService: AuditService;  
   }) \=\> MCPTool;

2. **Update MCPOAuthServer:** Update the orchestration server (src/mcp/server.ts) to accept an array of ToolFactory objects in its initialization or start options.  
3. **Registration Process:**  
   * In MCPOAuthServer.start(), the server instantiates all required dependencies (e.g., DelegationRegistry, AuditService).  
   * It then iterates over the provided tool factories, calling each one with the instantiated dependencies to get the final MCPTool object.  
   * Finally, it registers the result with this.server.addTool().

**Action Item:**

* **Phase 3:** Update src/mcp/server.ts to use a list of Tool Factories instead of direct tool imports.  
* **Phase 3:** Update src/mcp/tools/index.ts to export factories (e.g., createHealthCheckToolFactory) rather than the tool objects directly.