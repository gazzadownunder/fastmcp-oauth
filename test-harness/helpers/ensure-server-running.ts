/**
 * Server Health Check Helper
 *
 * Ensures MCP server is running before integration tests execute.
 * Provides clear error messages with instructions if server is not available.
 */

export interface ServerHealthCheckOptions {
  serverUrl: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export class ServerNotRunningError extends Error {
  constructor(
    serverUrl: string,
    public readonly lastError?: Error
  ) {
    super(
      `❌ MCP Server not running at ${serverUrl}\n\n` +
        `Please start the server before running integration tests:\n\n` +
        `  1. Build the project:\n` +
        `     npm run build\n\n` +
        `  2. Start the server:\n` +
        `     npm start\n` +
        `     (or with custom config: CONFIG_PATH=./test-harness/config/... npm start)\n\n` +
        `  3. Run integration tests:\n` +
        `     npm run test:integration\n` +
        `     npm run test:performance\n\n` +
        (lastError ? `Last error: ${lastError.message}` : '')
    );
    this.name = 'ServerNotRunningError';
  }
}

/**
 * Checks if the MCP server is running and healthy
 *
 * @throws {ServerNotRunningError} If server is not accessible after all attempts
 */
export async function ensureServerRunning(
  options: ServerHealthCheckOptions
): Promise<void> {
  const {
    serverUrl,
    maxAttempts = 3,
    retryDelayMs = 1000,
    timeoutMs = 5000,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Try to fetch from the server with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Server responded - consider it healthy even if response isn't perfect
      // (Auth failures are OK - we just need to know server is running)
      if (response.status === 200 || response.status === 401) {
        console.log(`✅ MCP Server is running at ${serverUrl}`);
        return;
      }

      lastError = new Error(
        `Server responded with unexpected status: ${response.status}`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        console.log(
          `⚠️  Server check attempt ${attempt}/${maxAttempts} failed, retrying in ${retryDelayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // All attempts failed
  throw new ServerNotRunningError(serverUrl, lastError);
}

/**
 * Checks if Keycloak IDP is accessible
 *
 * @throws {Error} If Keycloak is not accessible
 */
export async function ensureKeycloakRunning(
  keycloakUrl: string,
  realm: string
): Promise<void> {
  const wellKnownUrl = `${keycloakUrl}/realms/${realm}/.well-known/openid-configuration`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(wellKnownUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(`✅ Keycloak IDP is accessible at ${keycloakUrl}`);
      return;
    }

    throw new Error(`Keycloak responded with status: ${response.status}`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `❌ Keycloak IDP not accessible at ${keycloakUrl}\n` +
        `Realm: ${realm}\n` +
        `Tried: ${wellKnownUrl}\n` +
        `Error: ${errorMessage}\n\n` +
        `Please ensure Keycloak is running and the realm is configured.`
    );
  }
}
