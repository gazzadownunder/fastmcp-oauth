# **Supplementary Action Plan (Final): Addressing Integration Gaps**

This plan incorporates feedback regarding dependency management, failure policies, and service contracts, ensuring a friction-free implementation of session management, auditing, configuration flow, and dynamic tool registration.

## **Task 1: Refined Session Management and Failure Policy**

**Gap Addressed:** Clarifying precise session responsibilities and defining a robust failure policy for the RoleMapper.

| Component | Responsibility | Failure Policy (New) |
| :---- | :---- | :---- |
| **JWTValidator** (src/core/jwt-validator.ts) | Validation of token signature, expiry, and extraction of **raw claims**. | **Throws** a security error on token invalidation (e.g., expired, bad signature). |
| **RoleMapper** (src/core/role-mapper.ts) | Transformation of raw claims/roles into a standardized **primary role** and customRoles. | **Never throws.** If a role cannot be mapped, it assigns a specific **"Unassigned"** or **"Default"** role and returns a detailed **Audit Entry** describing the mapping failure. |
| **SessionManager** (src/core/session-manager.ts) | Orchestrates claim/role data to **construct, validate, and refresh** the structured UserSession object (the session contract). | Throws if the constructed session fails internal contract validation (e.g., if it lacks the required "Unassigned" role). |
| **AuthenticationService** (src/core/authentication-service.ts) | The public API. **Orchestrates** the Validator, Mapper, and Manager. Decides whether to reject a session based on the final assigned role (e.g., rejects if the session ends up with the "Unassigned" role). |  |

**Action Item:** Implement a dedicated **"Unassigned" role constant** in src/core/types.ts and enforce its use in the RoleMapper for all mapping failures.

## **Task 2: Centralized Auditing Mechanism (Dependency Simplification)**

**Gap Addressed:** Implementation friction caused by injecting the AuditService into every DelegationModule.

**Resolution:** Introduce an injectable AuditService in the Core Layer and centralize its usage via the DelegationRegistry.

1. **Create AuditService with Null Object Pattern:** Implement src/core/audit-service.ts.  
   * Expose log(entry: AuditEntry).  
   * **Crucially, its constructor must implement the Null Object Pattern:** If configuration is absent or invalid, it defaults to a no-op logger that satisfies the AuditService interface without crashing, ensuring audit calls never fail the process.  
2. **Core Layer Integration:** AuthenticationService is initialized with the AuditService and logs authentication events immediately.  
3. **Delegation Registry as Audit Hub (New):**  
   * The **DelegationRegistry** is initialized with the AuditService instance.  
   * The DelegationModule interface and implementation **do not** need to be updated to accept the AuditService. Instead, the module returns the auditTrail with its DelegationResult.  
   * The **MCPOAuthServer** will receive the DelegationResult and pass the auditTrail to its centralized AuditService instance for final logging. This keeps all persistence logic out of the individual modules.

**Action Item:**

* **Phase 2:** Update the DelegationRegistry to accept the AuditService as a dependency.  
* **Phase 3:** Ensure the MCPOAuthServer is responsible for receiving the DelegationResult.auditTrail and explicitly calling AuditService.log().

## **Task 3: Formalize Modular Configuration Flow**

**Gap Addressed:** Clarify how the configuration is loaded modularly and passed down through the layers.

1. **ConfigManager Responsibility:** Responsible for **loading the unified configuration object** from the file system and **validating it** against the UnifiedConfigSchema. It exposes typed getters for each layer.  
2. **Orchestrator Responsibility:** The MCPOAuthServer acts as the orchestrator and is responsible for passing the correct configuration subset to the correct component during initialization.

**Action Item:** (No change required, flow remains solid.) Ensure the MCPOAuthServer constructor and the registerDelegationModule method in src/mcp/server.ts explicitly demonstrate this configuration subsetting pattern.

## **Task 4: Define Dynamic Tool Registration (Full Context Injection)**

**Gap Addressed:** Dependency scoping limitations if a new shared service is introduced to the framework.

**Resolution:** Implement a dedicated Dependency Context object in the orchestration layer.

1. **Define CoreContext:** Create a new type (e.g., CoreContext) in src/mcp/types.ts that bundles all shared, initialized dependencies.  
   export type CoreContext \= {  
       registry: DelegationRegistry;  
       auditService: AuditService;  
       authService: AuthenticationService;  
       configManager: ConfigManager; // Include the manager for tools needing configuration lookups  
       // Any future framework services added here will be immediately available to tools.  
   };

2. **Update ToolFactory:** Update the ToolFactory to accept the entire CoreContext.  
   export type ToolFactory \= (context: CoreContext) \=\> MCPTool;

3. **Registration Process:** The MCPOAuthServer.start() method will:  
   * Instantiate all required services (AuditService, DelegationRegistry, etc.).  
   * Construct the single CoreContext object.  
   * Iterate over the provided tool factories, calling each one with the single CoreContext object.

**Action Item:**

* **Phase 3:** Update src/mcp/types.ts to include the CoreContext definition.  
* **Phase 3:** Refactor MCPOAuthServer.start() to build the context and pass it to all tool factories.  
* **Phase 3:** Update the tool creation functions in src/mcp/tools/ to accept and use the CoreContext.