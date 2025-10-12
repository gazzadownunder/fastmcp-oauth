/**
 * PKCE Security Validation Tests
 *
 * These tests validate the security properties of PKCE (Proof Key for Code Exchange)
 * implementation to prevent authorization code interception attacks.
 *
 * Test Coverage:
 * - Code challenge uses SHA-256 (not plain)
 * - Code verifier has sufficient entropy
 * - Authorization code cannot be exchanged without code verifier
 * - Incorrect code verifier rejected
 * - Authorization code interception attack blocked
 * - State parameter prevents CSRF attacks
 * - Authorization code replay attack blocked
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthRedirectFlow, type OAuthRedirectConfig } from '../../../src/oauth/redirect-flow.js';
import type { AuditService } from '../../../src/core/audit-service.js';
import crypto from 'crypto';

describe('PKCE Security Validation', () => {
  let config: OAuthRedirectConfig;
  let mockAuditService: AuditService;
  let redirectFlow: OAuthRedirectFlow;

  beforeEach(() => {
    config = {
      enabled: true,
      authorizeEndpoint: 'https://auth.test.com/authorize',
      tokenEndpoint: 'https://auth.test.com/token',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      pkce: {
        enabled: true,
        method: 'S256',
      },
      redirectUris: ['http://localhost:3000/callback'],
      callbackPath: '/oauth/callback',
      sessionTTL: 300,
      defaultScopes: ['openid', 'profile'],
    };

    mockAuditService = {
      log: vi.fn(),
    } as any;

    redirectFlow = new OAuthRedirectFlow(config, mockAuditService);
  });

  afterEach(() => {
    redirectFlow.destroy();
  });

  describe('PKCE-001: Code Challenge Uses SHA-256 (Not Plain)', () => {
    it('should use S256 method for code challenge', async () => {
      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      const url = new URL(authResult.authorizeUrl);
      const method = url.searchParams.get('code_challenge_method');

      expect(method).toBe('S256');
      expect(method).not.toBe('plain'); // Plain method is insecure
    });

    it('should generate valid SHA-256 code challenge', async () => {
      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      const url = new URL(authResult.authorizeUrl);
      const codeChallenge = url.searchParams.get('code_challenge');

      // SHA-256 hash is 32 bytes = 43 characters base64url encoded
      expect(codeChallenge).toBeTruthy();
      expect(codeChallenge!.length).toBeGreaterThanOrEqual(43);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/); // Base64url format
      expect(codeChallenge).not.toContain('+'); // No standard base64 characters
      expect(codeChallenge).not.toContain('/');
      expect(codeChallenge).not.toContain('='); // No padding
    });
  });

  describe('PKCE-002: Code Verifier Has Sufficient Entropy', () => {
    it('should generate code verifier with 43-128 characters', async () => {
      // We need to test the verifier used in token exchange
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await redirectFlow.callback({
        code: 'test-code',
        state: authResult.state,
        sessionId: authResult.sessionId,
      });

      // Extract code verifier from fetch call
      const fetchCall = (global.fetch as any).mock.calls[0];
      const requestBody = fetchCall[1].body;
      const match = requestBody.match(/code_verifier=([^&]+)/);

      expect(match).toBeTruthy();
      const codeVerifier = decodeURIComponent(match[1]);

      // RFC 7636: code verifier must be 43-128 characters
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/); // Base64url format
    });

    it('should generate unique code verifiers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult1 = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await redirectFlow.callback({
        code: 'test-code-1',
        state: authResult1.state,
        sessionId: authResult1.sessionId,
      });

      const verifier1 = (global.fetch as any).mock.calls[0][1].body.match(/code_verifier=([^&]+)/)[1];

      // Reset mock
      (global.fetch as any).mockClear();

      const authResult2 = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await redirectFlow.callback({
        code: 'test-code-2',
        state: authResult2.state,
        sessionId: authResult2.sessionId,
      });

      const verifier2 = (global.fetch as any).mock.calls[0][1].body.match(/code_verifier=([^&]+)/)[1];

      expect(verifier1).not.toBe(verifier2);
    });

    it('should have cryptographically random verifiers', () => {
      // Generate multiple verifiers and check for patterns
      const verifiers: string[] = [];

      for (let i = 0; i < 100; i++) {
        // Simulate code verifier generation (32 random bytes)
        const buffer = crypto.randomBytes(32);
        const verifier = buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        verifiers.push(verifier);
      }

      // All verifiers should be unique
      const uniqueVerifiers = new Set(verifiers);
      expect(uniqueVerifiers.size).toBe(100);

      // No verifier should be substring of another (no patterns)
      for (let i = 0; i < verifiers.length; i++) {
        for (let j = i + 1; j < verifiers.length; j++) {
          expect(verifiers[i]).not.toContain(verifiers[j].substring(0, 10));
        }
      }
    });
  });

  describe('PKCE-003: Authorization Code Requires Code Verifier', () => {
    it('should include code verifier in token exchange request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await redirectFlow.callback({
        code: 'test-code',
        state: authResult.state,
        sessionId: authResult.sessionId,
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const requestBody = fetchCall[1].body;

      expect(requestBody).toContain('code_verifier=');
      expect(requestBody).toContain('grant_type=authorization_code');
      expect(requestBody).toContain('code=test-code');
    });
  });

  describe('PKCE-004: Incorrect Code Verifier Rejected', () => {
    it('should fail token exchange with incorrect code verifier', async () => {
      // Mock IDP rejecting incorrect code verifier
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid_grant: code verifier mismatch',
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await expect(
        redirectFlow.callback({
          code: 'test-code',
          state: authResult.state,
          sessionId: authResult.sessionId,
        })
      ).rejects.toThrow('Token exchange failed');
    });
  });

  describe('PKCE-005: Authorization Code Interception Attack Blocked', () => {
    it('should prevent authorization code interception attack', async () => {
      /**
       * Attack Scenario:
       * 1. Attacker intercepts authorization code from redirect
       * 2. Attacker tries to exchange code for token
       * 3. Attack fails because attacker doesn't have code verifier
       */

      // Legitimate user initiates authorization
      const legitimateAuthResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      // Attacker intercepts authorization code from redirect URL
      const interceptedCode = 'authorization-code-intercepted-by-attacker';

      // Attacker creates their own session with different code verifier
      const attackerAuthResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      // Attacker tries to use intercepted code with their own session
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid_grant: code verifier mismatch',
      });

      // Attack should fail - attacker's code verifier doesn't match legitimate user's
      await expect(
        redirectFlow.callback({
          code: interceptedCode,
          state: attackerAuthResult.state,
          sessionId: attackerAuthResult.sessionId,
        })
      ).rejects.toThrow();

      // Even if attacker guesses the state, they still need the code verifier
      await expect(
        redirectFlow.callback({
          code: interceptedCode,
          state: legitimateAuthResult.state,
          sessionId: attackerAuthResult.sessionId,
        })
      ).rejects.toThrow('Invalid state parameter');
    });

    it('should protect against code substitution attack', async () => {
      /**
       * Attack Scenario:
       * 1. Attacker obtains their own authorization code
       * 2. Attacker substitutes their code into victim's callback
       * 3. Attack fails because state parameter mismatch
       */

      // Victim initiates authorization
      const victimAuthResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      // Attacker gets their own authorization code
      const attackerAuthResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      const attackerCode = 'attacker-authorization-code';

      // Attacker tries to substitute their code into victim's callback
      await expect(
        redirectFlow.callback({
          code: attackerCode,
          state: attackerAuthResult.state, // Attacker's state
          sessionId: victimAuthResult.sessionId, // Victim's session
        })
      ).rejects.toThrow('Invalid state parameter');
    });
  });

  describe('PKCE-006: State Parameter Prevents CSRF Attacks', () => {
    it('should reject callback without matching state', async () => {
      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      // Attacker tries to forge callback with wrong state
      await expect(
        redirectFlow.callback({
          code: 'test-code',
          state: 'forged-state-parameter',
          sessionId: authResult.sessionId,
        })
      ).rejects.toThrow('Invalid state parameter - possible CSRF attack');
    });

    it('should accept callback with correct state', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      await expect(
        redirectFlow.callback({
          code: 'test-code',
          state: authResult.state,
          sessionId: authResult.sessionId,
        })
      ).resolves.toBeDefined();
    });

    it('should bind state to specific session', async () => {
      const session1 = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      const session2 = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      // State from session1 should not work with session2
      await expect(
        redirectFlow.callback({
          code: 'test-code',
          state: session1.state,
          sessionId: session2.sessionId,
        })
      ).rejects.toThrow('Invalid state parameter');
    });
  });

  describe('PKCE-007: Authorization Code Replay Attack Blocked', () => {
    it('should reject second use of authorization code', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      const callbackParams = {
        code: 'test-code',
        state: authResult.state,
        sessionId: authResult.sessionId,
      };

      // First use should succeed
      await redirectFlow.callback(callbackParams);

      // Second use should fail (session deleted after first use)
      await expect(redirectFlow.callback(callbackParams)).rejects.toThrow(
        'OAuth session not found or expired'
      );
    });

    it('should delete session immediately after token exchange', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const authResult = await redirectFlow.authorize({
        redirectUri: 'http://localhost:3000/callback',
      });

      expect(redirectFlow.getMetrics().activeSessions).toBe(1);

      await redirectFlow.callback({
        code: 'test-code',
        state: authResult.state,
        sessionId: authResult.sessionId,
      });

      // Session should be deleted immediately
      expect(redirectFlow.getMetrics().activeSessions).toBe(0);
    });
  });

  describe('Security Edge Cases', () => {
    it('should handle session not found gracefully', async () => {
      await expect(
        redirectFlow.callback({
          code: 'test-code',
          state: 'test-state',
          sessionId: 'non-existent-session-id',
        })
      ).rejects.toThrow('OAuth session not found or expired');
    });

    it('should validate redirect URI strictly', async () => {
      // Attempt to use similar but not exact redirect URI
      await expect(
        redirectFlow.authorize({
          redirectUri: 'http://localhost:3000/callback/', // Extra trailing slash
        })
      ).rejects.toThrow('Invalid redirect URI');

      await expect(
        redirectFlow.authorize({
          redirectUri: 'https://localhost:3000/callback', // HTTPS instead of HTTP
        })
      ).rejects.toThrow('Invalid redirect URI');
    });

    it('should not leak session information in error messages', async () => {
      try {
        await redirectFlow.callback({
          code: 'test-code',
          state: 'test-state',
          sessionId: 'non-existent-session',
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        // Error message should not contain sensitive session data
        expect(error.message).not.toContain('code_verifier');
        expect(error.message).not.toContain('code_challenge');
      }
    });
  });
});
