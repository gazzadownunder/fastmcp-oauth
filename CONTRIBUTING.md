# Contributing to FastMCP OAuth

Thank you for your interest in contributing to FastMCP OAuth! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Branch Protection](#branch-protection)

## Code of Conduct

We expect all contributors to be respectful and professional. Please:

- Be welcoming to newcomers
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what is best for the community

## Getting Started

### Prerequisites

- Node.js 18+ ([download](https://nodejs.org/))
- npm 8+ (comes with Node.js)
- Git ([download](https://git-scm.com/))

### Local Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/fastmcp-oauth.git
   cd fastmcp-oauth
   ```

3. **Add upstream remote:**
   ```bash
   git remote add upstream https://github.com/gazzadownunder/fastmcp-oauth.git
   ```

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Build the project:**
   ```bash
   npm run build
   ```

6. **Verify everything works:**
   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```

   **All checks must pass** before you start making changes. If any fail, please open an issue.

## Development Workflow

### 1. Create a Feature Branch

Always create a new branch for your changes:

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features (e.g., `feature/add-ldap-delegation`)
- `fix/` - Bug fixes (e.g., `fix/jwt-validation-timeout`)
- `docs/` - Documentation updates (e.g., `docs/improve-quickstart`)
- `refactor/` - Code refactoring (e.g., `refactor/simplify-config-loader`)

### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 3. Run Quality Checks Locally

**Before committing**, ensure all checks pass:

```bash
# Type check
npm run typecheck

# Lint check
npm run lint

# Format check
npm run format -- --check

# Run all tests
npm test
```

**If any check fails, fix it before committing.**

### 4. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "Add LDAP delegation module

- Implement LDAPDelegationModule with bind/search operations
- Add integration tests for LDAP authentication
- Update documentation with LDAP configuration examples"
```

Good commit messages:
- Start with a verb (Add, Fix, Update, Remove, Refactor)
- Include a brief summary (50 chars or less)
- Add details in the body if needed

### 5. Keep Your Branch Updated

Before submitting a PR, sync with the latest upstream changes:

```bash
git fetch upstream
git rebase upstream/main
```

Resolve any merge conflicts if they occur.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage
```

### Writing Tests

All new features **must include tests**:

- **Unit tests:** Place in `tests/unit/` directory
- **Integration tests:** Place in `tests/integration/` directory
- Use descriptive test names: `it('should reject JWT with expired timestamp')`
- Test both success and failure cases
- Aim for >90% code coverage

Example test structure:

```typescript
import { describe, it, expect } from 'vitest';
import { MyNewFeature } from '../src/my-new-feature.js';

describe('MyNewFeature', () => {
  it('should handle valid input correctly', () => {
    const feature = new MyNewFeature();
    const result = feature.process('valid input');
    expect(result).toBe('expected output');
  });

  it('should throw error for invalid input', () => {
    const feature = new MyNewFeature();
    expect(() => feature.process(null)).toThrow('Invalid input');
  });
});
```

## Code Style

This project uses **TypeScript**, **ESLint**, and **Prettier** for code quality.

### Formatting

We use Prettier for consistent code formatting:

```bash
# Check formatting
npm run format -- --check

# Auto-fix formatting
npm run format
```

### Linting

We use ESLint to catch common issues:

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### TypeScript

- Use strict TypeScript settings
- Avoid `any` types when possible
- Prefer interfaces over types for object shapes
- Use meaningful variable and function names

### Best Practices

- **Security first:** Never commit secrets or credentials
- **Error handling:** Always handle errors gracefully
- **Documentation:** Add JSDoc comments for public APIs
- **Modularity:** Keep functions small and focused
- **DRY principle:** Don't repeat yourself

## Submitting Changes

### 1. Push Your Branch

```bash
git push origin feature/your-feature-name
```

### 2. Open a Pull Request

1. Go to [github.com/gazzadownunder/fastmcp-oauth](https://github.com/gazzadownunder/fastmcp-oauth)
2. Click "New Pull Request"
3. Select your fork and branch
4. Fill out the PR template (automatically provided)
5. Click "Create Pull Request"

### 3. PR Requirements

Your PR must meet these requirements to be merged:

✅ **All CI checks pass:**
- TypeScript type check
- ESLint linting
- Prettier formatting
- All tests passing

✅ **Code review approved** by a maintainer

✅ **Branch is up-to-date** with `main`

### 4. Review Process

- A maintainer will review your PR within 3-5 business days
- Address any requested changes
- Once approved and all checks pass, your PR will be merged

## Branch Protection

The `main` branch is protected with these rules:

- ❌ **No direct pushes** - All changes must come via Pull Request
- ✅ **Required status checks** - CI tests must pass
- ✅ **Required review** - At least one approval needed
- ✅ **Branch must be up-to-date** - Must include latest main commits

This ensures code quality and prevents breaking changes.

## Questions or Issues?

- **Bug reports:** [Open an issue](https://github.com/gazzadownunder/fastmcp-oauth/issues)
- **Feature requests:** [Start a discussion](https://github.com/gazzadownunder/fastmcp-oauth/discussions)
- **Questions:** [GitHub Discussions](https://github.com/gazzadownunder/fastmcp-oauth/discussions)

## License

By contributing to FastMCP OAuth, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉
