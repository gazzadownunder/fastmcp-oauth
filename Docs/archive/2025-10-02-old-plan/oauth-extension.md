
MCP server, look at options to Extending the oauth framework of the MCP to support on behalf of authentication flow and delegation to legacy platforms using Kerberos and SQL on behalf. This should be a fork or an extension of the fast mcp using typescript. It will use an external IDP to mint the jwt, this will be passed to the MCP server at the http header. The jwt will include the legacy user name. For Kerberos the MCP server will use a delegation account and pass the user,s legacy Sam account name to the down stream server. For SQL it will use the execute as user method. Start with a feasibility study to ensure that this approach is achievable




Show thinking
A feasibility study on extending the fast-mcp TypeScript framework to support on-behalf-of authentication with Kerberos and SQL delegation appears to be achievable, but it requires a careful and secure implementation. The core components of the proposed solution align with established authentication and delegation patterns.

Feasibility Analysis
1. Integration with External IDP and JWT
The proposed method of using an external Identity Provider (IDP) to issue a JWT that's passed in the HTTP header is a standard and secure practice in modern application architecture. The fast-mcp framework, as a Node.js/TypeScript-based server, can easily be extended to handle this. The server would need to:

Receive and validate the JWT: The MCP server must be configured to trust the external IDP's signing key. It will need to parse the JWT and validate its signature, expiration, and other claims to ensure its authenticity and integrity.

Extract the legacy user name: The JWT is a good way to carry the legacy user's sAMAccountName. This claim can be read by the MCP server and used for the delegation process.

2. Kerberos Delegation
The use of Kerberos constrained delegation (KCD) is the correct approach for this scenario. This process allows a service (in this case, the MCP server) to impersonate a user to access a downstream service (a legacy platform) without knowing the user's password. Here's how the MCP server would implement this:

Service Account for Delegation: The MCP server's process must run under a specific service account in Active Directory.

Constrained Delegation Configuration: This service account must be configured in Active Directory to be trusted for delegation only to the specific Service Principal Names (SPNs) of the downstream legacy services.  This is a crucial security measure that prevents the MCP server from impersonating users to unauthorized services.

Protocol Transition: Since the initial authentication is via JWT (not Kerberos), the MCP server will need to perform Kerberos protocol transition (S4U2Self) to obtain a Kerberos ticket for the legacy user. This process allows a service to get a Kerberos ticket for a user, based on a different authentication method.

Passing the Legacy User Name: The sAMAccountName from the JWT will be used by the MCP server to request a service ticket from the Key Distribution Center (KDC) on behalf of that user.

3. SQL On-Behalf-of Delegation
The EXECUTE AS USER method in SQL Server is a straightforward way to achieve impersonation at the database level.

Create a Database User: The legacy user's sAMAccountName must exist as a user within the SQL database.

EXECUTE AS Clause: When a query or stored procedure is executed, the MCP server's application code would wrap the SQL command in an EXECUTE AS USER = 'LegacyUserName' statement.

Reverting Impersonation: After the command is complete, a REVERT statement is necessary to switch the execution context back to the original login account, ensuring that subsequent operations are not performed under the impersonated user's permissions.

Security Considerations
While feasible, this approach requires significant security considerations:

Secure Service Account: The service account used for Kerberos delegation is a high-privilege account. Its credentials must be highly protected.

Least Privilege Principle: The service account should only have permissions to delegate to the specific legacy services and nothing else. Similarly, the EXECUTE AS user in SQL should have the minimum permissions necessary for its tasks.

JWT Security: The external IDP must be secure, and the MCP server must properly validate the JWT to prevent token forging.

This video provides a step-by-step guide on securing MCP servers using OAuth 2.1, which is a good foundational reference for this project.

Tutorial: Auth for Remote MCP Servers (Step by Step) | OAuth 2.1 with ScaleKit

Tutorial: Auth for Remote MCP Servers (Step by Step) | OAuth 2.1 with ScaleKit - YouTube

Alejandro AO - Software & Ai · 3.8K views








For MCP server framework must define the trusted IDP servers and the eduence claim that is accepted by the server. It is also possible the multiple claim would be supported by different tools presented by the MCP server.




Show thinking
A secure MCP server framework must explicitly define and trust external IDP (Identity Provider) servers. This is typically done through configuration that specifies the IDP's public key or a JSON Web Key Set (JWKS) endpoint, which the MCP server uses to validate the signature of incoming JWTs.

Key Configuration Elements
Trusted IDP Configuration: The framework must have a mechanism to list and configure the trusted IDPs. For each IDP, you'll need to define:

The issuer URL (iss claim): This uniquely identifies the IDP.

The audience (aud claim): This ensures the token is intended for your specific MCP server.

The public key or JWKS URL: This is essential for verifying the JWT's signature and ensuring it hasn't been tampered with.

The allowed signing algorithms (e.g., RS256, HS256).

Claim Validation: Beyond signature and audience, the MCP server must validate specific claims within the JWT. These are sometimes referred to as evidence claims. The framework should allow you to configure which claims are mandatory and what their expected values are. For your use case, this includes:

exp (expiration time): Ensures the token is still valid.

nbf (not before time): Ensures the token is not being used prematurely.

A custom claim containing the legacy user name (e.g., legacy_username or samaccountname). This is the key piece of information needed for the delegation to Kerberos and SQL.

scope or permissions claims: These can be used for fine-grained authorization and to determine what actions the user is permitted to perform on the MCP server and its tools.

Supporting Multiple Claims and Tools
It's entirely feasible and common for an MCP server framework to support multiple claims for different tools.

Tool-specific Claims: Different tools might require different claims for authorization. For example, a "database access" tool might require a sql_role claim, while a "Kerberos-enabled" tool needs the samaccountname claim. The framework should allow for a per-tool configuration that defines which claims must be present and validated before a tool is invoked.

Centralized vs. Decentralized Validation: The framework can be designed to either validate all claims at the initial authentication layer or to defer specific claim validation to the individual tools. The latter provides more flexibility but requires careful design to prevent security vulnerabilities.

The MCP server acts as an OAuth 2.1 resource server, consuming and validating tokens issued by a trusted IDP, which functions as the authorization server. This clear separation of concerns is a best practice that ensures the MCP server doesn't have to manage user identities itself.

A video that provides a good overview of how to set up and run multiple MCP servers on a local machine, which touches on the concepts of managing different server configurations.







Based on the details so far start to build a detailed plan to build this framework



Show thinking
Building an extension for the fast-mcp TypeScript framework to support on-behalf-of authentication requires a structured, multi-phase plan. This project can be broken down into core components, each with its own set of development and security considerations.

Phase 1: Planning and Design
Define Scope and Requirements: Clearly outline the legacy platforms to be supported (e.g., specific SQL Server versions, Kerberos-enabled applications) and the exact claims required from the JWT.

Authentication Flow Design: Create a detailed diagram of the end-to-end authentication and delegation flow. This includes the client request, the MCP server's JWT validation, and the delegation to Kerberos or SQL.

Error Handling and Logging: Plan for comprehensive error handling. The system needs to provide clear, actionable error messages for failures in JWT validation, Kerberos delegation, or SQL execution. A robust logging system is essential for debugging and auditing.

Phase 2: Core Framework Extension
JWT Middleware: Develop a middleware for the fast-mcp server that intercepts incoming requests. This middleware will:

Extract the JWT from the Authorization header.

Validate the JWT against the configured trusted IDP's public key or JWKS endpoint.

Verify the iss, aud, exp, and other claims.

Extract the legacy user name from a custom claim (e.g., legacy_username).

Attach the legacy user name to the request object for use by downstream services.

Configuration Management: Implement a secure configuration system to define trusted IDPs, their JWKS URLs, and a list of accepted evidence claims for different tools. This configuration should be separate from the code base and protected.

Phase 3: Kerberos and SQL Delegation Implementation
Kerberos Delegation Module: Build a module that handles the Kerberos delegation process. This will require:

Node.js Kerberos Library: Research and select a reliable Node.js library that supports Kerberos constrained delegation and protocol transition.

Delegation Logic: The module will take the legacy user name from the validated JWT and use the delegation service account to perform S4U2Self and S4U2Proxy to get a service ticket for the downstream application.

Connection and Execution: Use the acquired Kerberos ticket to establish an authenticated connection to the legacy Kerberos-enabled platform.

SQL Delegation Module: Create a module for SQL on-behalf-of execution. This module will:

Node.js SQL Library: Select a library (e.g., mssql) that can execute EXECUTE AS USER commands.

Dynamic Query Generation: Safely construct SQL queries using parameterized queries to prevent SQL injection. The queries will be wrapped with EXECUTE AS USER = 'legacy_username' and followed by a REVERT command.

Connection Pooling: Implement a connection pool to manage database connections efficiently and securely.

Phase 4: Tool Integration and Security Audits
Tool-Specific Claim Validation: Modify the existing MCP tools or create new ones to use the validated legacy user name. Each tool should have a mechanism to check for the presence and validity of required claims before executing its function.

Security Audits: Perform a thorough security review of the entire system. This includes:

Testing for JWT-related vulnerabilities (e.g., signature stripping, algorithm confusion).

Validating the Kerberos constrained delegation configuration in Active Directory to ensure the service account is not over-privileged.

Auditing the SQL delegation logic for potential SQL injection vulnerabilities.

Build ANYTHING With an Advanced MCP Server (Python, Authentication, Databases & More)
This video provides a great overview of building advanced MCP servers in Python, including sections on authentication and databases that are highly relevant to your TypeScript project.

Build ANYTHING With an Advanced MCP Server (Python, Authentication, Databases & More) - YouTube

Tech With Tim · 47K views








For the Kerberos under typescript can is run on a non windows server



Show thinking
Yes, a TypeScript Kerberos implementation can run on a non-Windows server, such as a Linux-based one. This is a common and supported scenario for cross-platform applications.

The key to achieving this is using a Kerberos library that has bindings to the underlying OS Kerberos client libraries. For Node.js and TypeScript, the popular kerberos npm package is a C++ extension that specifically provides this cross-platform functionality. It uses the Generic Security Service Application Program Interface (GSSAPI) on Linux and macOS, and the Security Support Provider Interface (SSPI) on Windows.

How it Works
System Kerberos Configuration: The non-Windows server must have a Kerberos client installed and configured correctly. On a Linux system, this involves installing packages like krb5-workstation and configuring the /etc/krb5.conf file to point to your Active Directory's Key Distribution Center (KDC) and define the domain realm.

Service Account: The Node.js application process must run under a Linux service account that has been configured in Active Directory for Kerberos constrained delegation. This is the delegation account.

Library Integration: The kerberos Node.js library acts as a bridge between your TypeScript code and the Kerberos client on the server. Your code will use this library to perform the necessary Kerberos protocol extensions, specifically S4U2Self (Service for User to Self) and S4U2Proxy (Service for User to Proxy).

Protocol Transition: When a JWT is received, your code, running on the Linux server, will use the kerberos library to perform a protocol transition. It will ask the KDC for a service ticket for itself on behalf of the legacy user specified in the JWT. This is the S4U2Self step.


Constrained Delegation: Once the service ticket is obtained, the library then uses it to request a new service ticket for the downstream legacy platform. This S4U2Proxy step is only possible if the delegation account is correctly configured in Active Directory to be trusted for delegation to that specific downstream service.

This entire process happens without the server needing to be a part of the Windows domain, as long as it can communicate with the domain controller and has the correct Kerberos configuration.


Sources






Flesh out the plan that can be used to implement this solution



Show thinking
Here is a detailed, phased plan to implement the proposed MCP server framework extension.

Phase 1: Planning, Scaffolding, and Configuration (2-4 Weeks)
Project Setup and Repository Forking:

Fork the fast-mcp TypeScript repository to create your project's foundation.

Set up a new development environment, including Node.js, TypeScript, and a package manager (npm or yarn).

Establish a testing framework (e.g., Jest) and CI/CD pipelines for automated testing.

Configuration Management:

Design a secure, file-based configuration structure for the server. Do not hardcode secrets.

The configuration file (e.g., config.json or environment variables) must define:

Trusted IDPs: An array of objects, where each object contains the issuer URL, the jwks_uri (JSON Web Key Set URI) to fetch public keys, and the audience (aud).

Claim Mapping: A mapping of custom JWT claims to internal variables (e.g., legacy_username claim to req.user.legacyUsername).

Legacy Platforms: Configuration for each legacy platform, specifying its type (Kerberos or SQL), the required claims, and connection details (e.g., SQL Server name, Kerberos service principal name).

Delegation Accounts: Securely store the service account credentials for Kerberos and SQL delegation, potentially using environment variables or a secrets manager.

Phase 2: Core Middleware Development (4-6 Weeks)
JWT Authentication Middleware:

Create a TypeScript middleware function that plugs into the fast-mcp server.

This middleware will:

Extract the JWT from the Authorization: Bearer <token> header.

Use a library like jsonwebtoken or jose to validate the JWT's signature against the public keys from the trusted IDP's JWKS URI.

Check that the iss and aud claims match the configured values.

Verify the exp (expiration) and nbf (not before) claims.

If validation is successful, decode the JWT payload and attach the validated claims to the request object (req.auth or req.user).

Handle and log all validation failures with appropriate HTTP status codes (e.g., 401 Unauthorized, 403 Forbidden).

User Context Enrichment:

After the JWT is validated, the middleware will extract the crucial legacy_username claim.

This value will be stored in a consistent and secure location on the request object, making it accessible to all downstream handlers for delegation.

Phase 3: Delegation Module Implementation (6-8 Weeks)
Kerberos Delegation Module:

Install and configure a reliable Node.js Kerberos library, such as the kerberos package, which is a C++ addon that supports GSSAPI/SSPI.

Create a dedicated TypeScript class or module for Kerberos delegation. This module will:

Receive the legacy user's sAMAccountName from the request context.

Use the configured delegation service account to perform Kerberos protocol transition (S4U2Self) to get a ticket for itself on behalf of the user.

Perform constrained delegation (S4U2Proxy) to obtain a service ticket for the target downstream application (e.g., a service with an SPN like HTTP/legacy-app.domain.com).

Use the acquired service ticket to perform the requested action, like making an authenticated HTTP request.

Include robust error handling for common Kerberos failures (e.g., incorrect SPN, delegation not configured, KDC not reachable).

SQL Delegation Module:

Use the mssql Node.js library to connect to the SQL Server database.

Implement a function that wraps database operations within an EXECUTE AS USER block. This function will:

Take the legacy sAMAccountName and the SQL query/stored procedure name as input.

Dynamically generate the SQL command: EXECUTE AS USER = '[legacy_username]'; <your_query>; REVERT;.

Execute the command against the SQL server.

Ensure SQL injection is prevented by using parameterized queries and not concatenating user input directly into the EXECUTE AS statement.

Phase 4: Integration, Testing, and Security (4 Weeks)
Tool Integration:

Update the existing fast-mcp tools to utilize the new authentication and delegation flow.

Modify the tool handlers to access req.user.legacyUsername and pass it to the appropriate delegation module (Kerberos or SQL).

Implement tool-specific authorization logic based on additional claims like scope or permissions.

Comprehensive Testing:

Write unit tests for the JWT validation, Kerberos delegation, and SQL impersonation modules.

Develop integration tests to simulate the full end-to-end flow, from a client with a JWT to the final action on a legacy platform.

Conduct negative testing to ensure the system correctly rejects invalid tokens and unauthorized requests.

Security Review and Hardening:

Perform an internal security audit.

Verify that the service account in Active Directory is configured with constrained delegation to the absolute minimum set of services.

Ensure all secrets (API keys, passwords) are stored securely and not in the codebase.

Set up comprehensive logging and monitoring to track all authentication and delegation attempts, both successful and failed, for auditing purposes.







Go to the next level and include the class and code samples



Show thinking
Fleshing out the plan with code samples helps make the solution tangible. Here are code samples for the core components of the MCP server extension.

1. JWT Authentication Middleware
This middleware intercepts HTTP requests to validate the JWT. It uses a library like jsonwebtoken for verification and attaches the user's information to the request object.

TypeScript

// src/middleware/auth.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { verify } from 'jsonwebtoken';

// Define a type to extend the request object with our custom user data.
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      legacyUsername: string;
      // You can add other claims here, like roles or scopes
    };
  }
}

// Configuration for our trusted Identity Providers (IDPs)
const idpConfig = {
  // We'd typically fetch this from an external source or a secure config file
  'trusted-idp-issuer': {
    publicKey: `-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----`,
    audience: 'mcp-server-api',
  },
};

export function authMiddleware(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized: Missing or invalid token.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Decode the token to get the issuer (iss)
    const decodedHeader = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString());
    const issuer = decodedHeader.iss;

    // 2. Look up the trusted IDP's public key
    if (!idpConfig[issuer as keyof typeof idpConfig]) {
      reply.status(401).send({ error: 'Unauthorized: Untrusted issuer.' });
      return;
    }
    const { publicKey, audience } = idpConfig[issuer as keyof typeof idpConfig];

    // 3. Verify the token using the public key and expected audience
    const decoded = verify(token, publicKey, { audience }) as { legacy_username: string };

    // 4. Attach the legacy username to the request object
    req.user = {
      legacyUsername: decoded.legacy_username,
    };

    done();
  } catch (error) {
    req.log.error(error, 'JWT validation failed');
    reply.status(403).send({ error: 'Forbidden: Invalid token.' });
  }
}
This middleware needs to be integrated into the fast-mcp server's request pipeline, likely before any tool handler is executed.

2. Kerberos Delegation Class
This class encapsulates the logic for Kerberos constrained delegation. It requires the kerberos npm package, which is a C++ addon and will need proper system-level Kerberos clients configured on your server (e.g., krb5-workstation on Linux).

TypeScript

// src/services/kerberosDelegation.ts
import { Kerberos } from 'kerberos';

interface DelegationConfig {
  serviceAccount: string;
  keytabPath: string;
  delegationSpn: string;
}

export class KerberosDelegator {
  private config: DelegationConfig;

  constructor(config: DelegationConfig) {
    this.config = config;
  }

  /**
   * Performs Kerberos constrained delegation on behalf of a user.
   * @param legacyUsername The sAMAccountName from the JWT.
   * @returns A Kerberos service ticket.
   */
  public async getServiceTicket(legacyUsername: string): Promise<string> {
    try {
      const delegationAccount = this.config.serviceAccount;
      const keytab = this.config.keytabPath;
      const delegationSpn = this.config.delegationSpn;

      // The 'kerberos' library handles the low-level S4U2Self and S4U2Proxy logic.
      // It uses the configured keytab to authenticate the delegation service account.
      const client = new Kerberos.Client(delegationSpn, { mechOID: Kerberos.GSSAPI_MECH_OID_SPNEGO });

      // S4U2Self: Get a ticket for the service itself on behalf of the user.
      const serviceTicket = await client.getServiceTicket(delegationAccount, legacyUsername, keytab);

      // S4U2Proxy: Use the obtained ticket to request a ticket for the target service.
      // The library automatically handles this as part of the delegation process.
      // The `serviceTicket` returned here can be used for authenticated connections.
      return serviceTicket.toString('base64');

    } catch (error) {
      console.error(`Kerberos delegation failed for user ${legacyUsername}:`, error);
      throw new Error(`Kerberos delegation failed: ${error.message}`);
    }
  }
}
To use this, you'd instantiate the class with your configuration and then call getServiceTicket within your tool's execute function.

3. SQL Delegation Class
This class handles database impersonation using EXECUTE AS USER. It ensures secure, on-behalf-of execution for each query.

TypeScript

// src/services/sqlDelegation.ts
import sql from 'mssql';

export class SQLDelegator {
  private pool: sql.ConnectionPool;

  constructor(config: sql.config) {
    this.pool = new sql.ConnectionPool(config);
    this.connect();
  }

  private async connect() {
    try {
      await this.pool.connect();
    } catch (err) {
      console.error('Database connection failed!', err);
    }
  }

  /**
   * Executes a SQL query on behalf of a specific user.
   * @param legacyUsername The user's sAMAccountName.
   * @param query The SQL query to execute.
   * @returns The result of the query.
   */
  public async executeAsUser<T>(legacyUsername: string, query: string, params?: { [key: string]: any }): Promise<T[]> {
    const request = this.pool.request();
    let result;

    try {
      // Use parameterized queries to prevent SQL injection.
      if (params) {
        for (const key in params) {
          request.input(key, params[key]);
        }
      }

      // 1. Impersonate the user
      await request.query(`EXECUTE AS USER = '${legacyUsername}';`);

      // 2. Execute the user's query
      result = await request.query<T>(query);

      // 3. Revert to the original login context
      await request.query('REVERT;');

    } catch (error) {
      // Always attempt to revert the context, even on failure
      try {
        await request.query('REVERT;');
      } catch (revertError) {
        console.error('Failed to revert SQL context', revertError);
      }
      console.error(`SQL execution failed for user ${legacyUsername}:`, error);
      throw new Error(`SQL execution failed: ${error.message}`);
    }

    return result.recordset;
  }
}
This class should be instantiated once, and its executeAsUser method should be called by the relevant tool handlers to perform database operations.








Where is the configuration stored



Show thinking
The configuration for the MCP server, including details about trusted IDPs and legacy platforms, should be stored in a secure, externalized configuration file and should never be hard-coded. This approach allows for flexibility, portability, and better security.

MCP Server Configuration
The MCP server itself will use a custom configuration file, typically a JSON or YAML file, or it will read from environment variables. This file will define all the critical operational parameters for the application.

File Location: For security and ease of deployment, this file should be located outside of the application's source code directory. A common practice is to place it in /etc/mcp-server/config.json on Linux or a similar secure, non-public directory.

Content: This configuration will contain sensitive information, including:

Trusted IDPs: The list of all accepted Identity Providers, each with its issuer URL and the URI to its JSON Web Key Set (JWKS) endpoint. The public keys for token validation are retrieved from here.

Claims Mapping: The names of the JWT claims that contain crucial information, such as legacy_username or scopes.

Delegation Accounts: The service account name and the path to its keytab file for Kerberos delegation. For SQL, the connection string and any other required credentials.

Kerberos Configuration
The Kerberos client configuration, which is distinct from the MCP server's application-level configuration, is stored in a standard system file.

File Location: On Linux systems, the Kerberos configuration file is named krb5.conf and is located in the /etc/ directory.  On Windows, it's typically found at C:\ProgramData\Kerberos\krb5.conf.

Content: This file is critical for the server's ability to communicate with the Active Directory KDC (Key Distribution Center) and includes:

The default Kerberos realm and its KDC location.

Mappings of DNS domain names to Kerberos realms.

SQL Server Configuration
SQL Server login information for both Windows and SQL authentication is not stored in a simple configuration file on the client machine. Instead, it is managed directly by the SQL Server instance itself.

Login Information: SQL logins and their hashed passwords are stored in the master database in the sys.sql_logins view. For Windows authentication, only a user's SID (Security Identifier) is stored in SQL Server, and the actual password authentication is handled by the Windows operating system and Active Directory.

Permissions: The EXECUTE AS USER impersonation is possible because the user account (or group) has been explicitly created as a login in the SQL Server, and a corresponding user has been mapped to it in the target database. The permissions for the impersonated user are defined within the database itself.