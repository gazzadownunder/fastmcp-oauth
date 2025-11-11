/**
 * Unit Tests for EnvProvider
 *
 * Tests environment variable-based secret resolution with various scenarios including:
 * - Successful secret resolution from process.env
 * - Missing environment variables (undefined return)
 * - Empty string handling
 * - Whitespace trimming
 * - Special characters
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvProvider } from '../../../../src/config/secrets/providers/EnvProvider.js';

describe('EnvProvider', () => {
  let provider: EnvProvider;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    provider = new EnvProvider();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('resolve', () => {
    it('should resolve secret from environment variable', async () => {
      process.env.DB_PASSWORD = 'ServicePass123!';

      const result = await provider.resolve('DB_PASSWORD');

      expect(result).toBe('ServicePass123!');
    });

    it('should return undefined for non-existent environment variable', async () => {
      delete process.env.NONEXISTENT_VAR;

      const result = await provider.resolve('NONEXISTENT_VAR');

      expect(result).toBeUndefined();
    });

    it('should trim whitespace from environment variable', async () => {
      process.env.SECRET_WITH_WHITESPACE = '  MySecret123!  ';

      const result = await provider.resolve('SECRET_WITH_WHITESPACE');

      expect(result).toBe('MySecret123!');
    });

    it('should handle empty string environment variable', async () => {
      process.env.EMPTY_SECRET = '';

      const result = await provider.resolve('EMPTY_SECRET');

      expect(result).toBeUndefined(); // Empty strings treated as undefined
    });

    it('should handle environment variable with only whitespace', async () => {
      process.env.WHITESPACE_ONLY = '   \n\t  ';

      const result = await provider.resolve('WHITESPACE_ONLY');

      expect(result).toBe(''); // Trimmed to empty string
    });

    it('should handle special characters in environment variable', async () => {
      const specialSecret = '!@#$%^&*()_+-={}[]|:;"<>?,./~`';
      process.env.SPECIAL_CHARS = specialSecret;

      const result = await provider.resolve('SPECIAL_CHARS');

      expect(result).toBe(specialSecret);
    });

    it('should handle multiline environment variable', async () => {
      const multilineSecret = 'line1\nline2\nline3';
      process.env.MULTILINE_SECRET = multilineSecret;

      const result = await provider.resolve('MULTILINE_SECRET');

      expect(result).toBe(multilineSecret);
    });

    it('should handle very long environment variable', async () => {
      const longSecret = 'A'.repeat(10000); // 10KB
      process.env.LONG_SECRET = longSecret;

      const result = await provider.resolve('LONG_SECRET');

      expect(result).toBe(longSecret);
      expect(result?.length).toBe(10000);
    });

    it('should handle UTF-8 encoded environment variable', async () => {
      const utf8Secret = 'パスワード123!🔐';
      process.env.UTF8_SECRET = utf8Secret;

      const result = await provider.resolve('UTF8_SECRET');

      expect(result).toBe(utf8Secret);
    });

    it('should handle numeric environment variable', async () => {
      process.env.NUMERIC_SECRET = '12345';

      const result = await provider.resolve('NUMERIC_SECRET');

      expect(result).toBe('12345');
      expect(typeof result).toBe('string'); // Should remain string
    });

    it('should handle boolean-like environment variable', async () => {
      process.env.BOOL_SECRET = 'true';

      const result = await provider.resolve('BOOL_SECRET');

      expect(result).toBe('true');
      expect(typeof result).toBe('string'); // Should remain string
    });

    it('should be case-sensitive', async () => {
      process.env.lowercase_secret = 'LowerValue';
      process.env.UPPERCASE_SECRET = 'UpperValue';

      const result1 = await provider.resolve('lowercase_secret');
      const result2 = await provider.resolve('UPPERCASE_SECRET');
      const result3 = await provider.resolve('Lowercase_Secret');

      expect(result1).toBe('LowerValue');
      expect(result2).toBe('UpperValue');
      expect(result3).toBeUndefined(); // Case doesn't match
    });

    it('should handle concurrent reads correctly', async () => {
      process.env.CONCURRENT_SECRET = 'ConcurrentValue';

      // Read same secret concurrently
      const results = await Promise.all([
        provider.resolve('CONCURRENT_SECRET'),
        provider.resolve('CONCURRENT_SECRET'),
        provider.resolve('CONCURRENT_SECRET'),
        provider.resolve('CONCURRENT_SECRET'),
        provider.resolve('CONCURRENT_SECRET'),
      ]);

      // All reads should succeed with same value
      results.forEach((result) => {
        expect(result).toBe('ConcurrentValue');
      });
    });

    it('should handle environment variable changes between calls', async () => {
      process.env.CHANGING_SECRET = 'InitialValue';

      const result1 = await provider.resolve('CHANGING_SECRET');
      expect(result1).toBe('InitialValue');

      // Change value
      process.env.CHANGING_SECRET = 'NewValue';

      const result2 = await provider.resolve('CHANGING_SECRET');
      expect(result2).toBe('NewValue');
    });

    it('should handle environment variable deletion between calls', async () => {
      process.env.TRANSIENT_SECRET = 'TransientValue';

      const result1 = await provider.resolve('TRANSIENT_SECRET');
      expect(result1).toBe('TransientValue');

      // Delete variable
      delete process.env.TRANSIENT_SECRET;

      const result2 = await provider.resolve('TRANSIENT_SECRET');
      expect(result2).toBeUndefined();
    });
  });

  describe('ISecretProvider interface compliance', () => {
    it('should implement resolve method', () => {
      expect(typeof provider.resolve).toBe('function');
    });

    it('should return Promise from resolve', () => {
      const result = provider.resolve('TEST');
      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve to string or undefined', async () => {
      delete process.env.NONEXISTENT;
      const result1 = await provider.resolve('NONEXISTENT');
      expect(typeof result1 === 'string' || result1 === undefined).toBe(true);

      process.env.EXISTENT = 'value';
      const result2 = await provider.resolve('EXISTENT');
      expect(typeof result2 === 'string' || result2 === undefined).toBe(true);
    });
  });

  describe('security considerations', () => {
    it('should not expose all environment variables', () => {
      // EnvProvider should only resolve requested variables, not expose all
      process.env.SECRET_VAR = 'SecretValue';
      process.env.OTHER_SECRET = 'OtherValue';

      // Provider doesn't have a "listAll" method
      expect((provider as any).listAll).toBeUndefined();
    });

    it('should handle shell injection attempts safely', async () => {
      // Environment variables are strings, not executed
      process.env.INJECTION_ATTEMPT = '$(rm -rf /)';

      const result = await provider.resolve('INJECTION_ATTEMPT');

      // Should return the literal string, not execute it
      expect(result).toBe('$(rm -rf /)');
    });

    it('should handle environment variable names with special characters', async () => {
      // Most shells don't allow special characters in env var names,
      // but process.env does
      process.env['VAR-WITH-DASH'] = 'DashValue';
      process.env['VAR.WITH.DOT'] = 'DotValue';

      const result1 = await provider.resolve('VAR-WITH-DASH');
      const result2 = await provider.resolve('VAR.WITH.DOT');

      expect(result1).toBe('DashValue');
      expect(result2).toBe('DotValue');
    });
  });

  describe('dotenv integration', () => {
    it('should work with variables loaded from .env file', async () => {
      // Simulate dotenv.config() by setting env vars
      process.env.FROM_DOTENV = 'DotenvValue';

      const result = await provider.resolve('FROM_DOTENV');

      expect(result).toBe('DotenvValue');
    });

    it('should handle environment variable precedence', async () => {
      // If both system env and .env define same var,
      // system env takes precedence (dotenv behavior)
      process.env.PRECEDENCE_TEST = 'SystemValue';

      const result = await provider.resolve('PRECEDENCE_TEST');

      expect(result).toBe('SystemValue');
    });
  });
});
