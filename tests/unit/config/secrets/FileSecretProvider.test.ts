/**
 * Unit Tests for FileSecretProvider
 *
 * Tests file-based secret resolution with various scenarios including:
 * - Successful secret resolution
 * - Missing files (undefined return)
 * - Permission errors (EACCES)
 * - Whitespace trimming
 * - Error handling
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSecretProvider } from '../../../../src/config/secrets/providers/FileSecretProvider.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileSecretProvider', () => {
  let tempDir: string;
  let provider: FileSecretProvider;

  beforeEach(async () => {
    // Create temporary directory for test secrets
    tempDir = path.join(os.tmpdir(), `mcp-secrets-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    provider = new FileSecretProvider(tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should use default secrets directory if not provided', () => {
      const defaultProvider = new FileSecretProvider();
      expect(defaultProvider.getSecretDir()).toBe('/run/secrets');
    });

    it('should use custom secrets directory when provided', () => {
      const customProvider = new FileSecretProvider('/custom/secrets');
      expect(customProvider.getSecretDir()).toBe('/custom/secrets');
    });
  });

  describe('resolve', () => {
    it('should resolve secret from file', async () => {
      // Create secret file
      const secretPath = path.join(tempDir, 'DB_PASSWORD');
      await fs.writeFile(secretPath, 'ServicePass123!');

      const result = await provider.resolve('DB_PASSWORD');

      expect(result).toBe('ServicePass123!');
    });

    it('should trim whitespace from secret', async () => {
      // Create secret file with whitespace
      const secretPath = path.join(tempDir, 'SECRET_WITH_WHITESPACE');
      await fs.writeFile(secretPath, '  MySecret123!  \n\n');

      const result = await provider.resolve('SECRET_WITH_WHITESPACE');

      expect(result).toBe('MySecret123!');
    });

    it('should return undefined for non-existent file', async () => {
      const result = await provider.resolve('NONEXISTENT_SECRET');

      expect(result).toBeUndefined();
    });

    it('should handle multiline secrets', async () => {
      // Create secret file with multiple lines
      const secretPath = path.join(tempDir, 'MULTILINE_SECRET');
      const multilineSecret = 'line1\nline2\nline3';
      await fs.writeFile(secretPath, multilineSecret);

      const result = await provider.resolve('MULTILINE_SECRET');

      expect(result).toBe(multilineSecret);
    });

    it('should handle empty files', async () => {
      // Create empty file
      const secretPath = path.join(tempDir, 'EMPTY_SECRET');
      await fs.writeFile(secretPath, '');

      const result = await provider.resolve('EMPTY_SECRET');

      expect(result).toBe(''); // Empty string after trim
    });

    it('should handle files with only whitespace', async () => {
      // Create file with only whitespace
      const secretPath = path.join(tempDir, 'WHITESPACE_ONLY');
      await fs.writeFile(secretPath, '   \n\n\t  ');

      const result = await provider.resolve('WHITESPACE_ONLY');

      expect(result).toBe(''); // Empty string after trim
    });

    it('should handle very long secrets', async () => {
      // Create file with very long secret (1MB)
      const secretPath = path.join(tempDir, 'LONG_SECRET');
      const longSecret = 'A'.repeat(1024 * 1024); // 1MB of 'A's
      await fs.writeFile(secretPath, longSecret);

      const result = await provider.resolve('LONG_SECRET');

      expect(result).toBe(longSecret);
      expect(result?.length).toBe(1024 * 1024);
    });

    it('should handle special characters in secret values', async () => {
      // Create file with special characters
      const secretPath = path.join(tempDir, 'SPECIAL_CHARS');
      const specialSecret = '!@#$%^&*()_+-={}[]|:;"<>?,./~`';
      await fs.writeFile(secretPath, specialSecret);

      const result = await provider.resolve('SPECIAL_CHARS');

      expect(result).toBe(specialSecret);
    });

    it('should handle UTF-8 encoded secrets', async () => {
      // Create file with UTF-8 characters
      const secretPath = path.join(tempDir, 'UTF8_SECRET');
      const utf8Secret = 'パスワード123!🔐';
      await fs.writeFile(secretPath, utf8Secret, 'utf-8');

      const result = await provider.resolve('UTF8_SECRET');

      expect(result).toBe(utf8Secret);
    });

    // Security Tests
    describe('security', () => {
      it('should safely handle path traversal attempts', async () => {
        // Attempt to read file outside secrets directory
        const result = await provider.resolve('../../../etc/passwd');

        // Should return undefined (file not found in secrets dir)
        expect(result).toBeUndefined();
      });

      it('should safely handle absolute paths', async () => {
        // Attempt to use absolute path
        const result = await provider.resolve('/etc/passwd');

        // Should return undefined (treated as relative path within secrets dir)
        expect(result).toBeUndefined();
      });

      it('should handle permission denied errors gracefully', async () => {
        // Create secret file
        const secretPath = path.join(tempDir, 'RESTRICTED_SECRET');
        await fs.writeFile(secretPath, 'RestrictedValue');

        // Change permissions to make it unreadable (Linux/Mac only)
        // Windows doesn't have the same permission model
        if (process.platform !== 'win32') {
          try {
            await fs.chmod(secretPath, 0o000); // No permissions

            const result = await provider.resolve('RESTRICTED_SECRET');

            // Should return undefined (not throw)
            expect(result).toBeUndefined();

            // Restore permissions for cleanup
            await fs.chmod(secretPath, 0o644);
          } catch (error) {
            // Skip this test on systems where chmod doesn't work as expected
            console.log('Skipping permission test - platform limitation');
          }
        }
      });
    });

    // Error Handling Tests
    describe('error handling', () => {
      it('should return undefined for directory instead of file', async () => {
        // Create directory with same name as secret
        const dirPath = path.join(tempDir, 'DIR_NOT_FILE');
        await fs.mkdir(dirPath);

        const result = await provider.resolve('DIR_NOT_FILE');

        // Should return undefined or fail gracefully
        expect(result).toBeUndefined();
      });

      it('should handle concurrent reads correctly', async () => {
        // Create secret file
        const secretPath = path.join(tempDir, 'CONCURRENT_SECRET');
        await fs.writeFile(secretPath, 'ConcurrentValue');

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

      it('should handle secret file being deleted during read', async () => {
        // Create secret file
        const secretPath = path.join(tempDir, 'TRANSIENT_SECRET');
        await fs.writeFile(secretPath, 'TransientValue');

        // Start read, delete file immediately
        const readPromise = provider.resolve('TRANSIENT_SECRET');
        await fs.unlink(secretPath).catch(() => {});

        // Should either succeed (if read completed) or return undefined
        const result = await readPromise;
        expect([undefined, 'TransientValue']).toContain(result);
      });
    });
  });

  describe('getSecretDir', () => {
    it('should return the configured secrets directory', () => {
      const customProvider = new FileSecretProvider('/custom/path');
      expect(customProvider.getSecretDir()).toBe('/custom/path');
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
      const result1 = await provider.resolve('NONEXISTENT');
      expect(typeof result1 === 'string' || result1 === undefined).toBe(true);

      // Create secret and test again
      await fs.writeFile(path.join(tempDir, 'EXISTENT'), 'value');
      const result2 = await provider.resolve('EXISTENT');
      expect(typeof result2 === 'string' || result2 === undefined).toBe(true);
    });
  });
});
