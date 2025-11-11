/**
 * Secret Management Module
 *
 * Provides dynamic configuration resolution for secure secrets management.
 * This module eliminates hardcoded secrets from configuration files.
 *
 * @see Docs/SECRETS-MANAGEMENT.md
 */

// Core interfaces and classes
export type { ISecretProvider } from './ISecretProvider.js';
export { isSecretProvider } from './ISecretProvider.js';
export { SecretResolver, type SecretResolverConfig } from './SecretResolver.js';

// Built-in providers
export { FileSecretProvider } from './providers/FileSecretProvider.js';
export { EnvProvider } from './providers/EnvProvider.js';
