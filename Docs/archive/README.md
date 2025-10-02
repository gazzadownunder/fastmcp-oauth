# Documentation Archive

This directory contains historical documentation from the development and debugging of the FastMCP OAuth On-Behalf-Of framework.

**⚠️ These documents are ARCHIVED and may contain outdated information.**

For current documentation, see:
- [../NPM-LIBRARY-VERIFICATION.md](../NPM-LIBRARY-VERIFICATION.md) - Confirms npm packages have all features
- [../../CLAUDE.md](../../CLAUDE.md) - Main development guide
- [../../README.md](../../README.md) - Project overview

---

## Archive Structure

### [2025-09-30-initial-patches/](2025-09-30-initial-patches/)

**Context:** Initial discovery and documentation of OAuth stateless authentication features

**Files:**
- PATCH-APPLIED.md - Documents per-request authentication fix
- CORS-FIX-APPLIED.md - Documents CORS header fixes for Authorization
- STATELESS-SESSION-FIX.md - Documents stateless session management
- FASTMCP-AUTHENTICATION-BUG.md - Original bug analysis
- GITHUB-ISSUE.md - Draft GitHub issue for upstream
- PR-SUBMISSION-GUIDE.md - Guide for submitting fixes upstream
- FINAL-FIX-SUMMARY.md - Summary of all three fixes

**Status:** These "patches" are now in official npm releases (mcp-proxy@5.8.0, fastmcp@3.19.0)

---

### [2025-10-01-session-handling/](2025-10-01-session-handling/)

**Context:** Evolution of session ID handling strategy from dummy values to real session IDs

**Files:**
- PROPER-SESSION-HANDLING.md - Documents "Real Session IDs" approach (Approach 1)
- CLIENT-FIX-APPLIED.md - Removed placeholder "pending" session ID
- SESSION-ID-FIX.md - Various session ID debugging attempts
- ALL-FIXES-COMPLETE.md - Summary of all fixes working together
- FORKS-VERIFIED.md - Verification that GitHub forks had fixes
- DEPENDENCY-FIX-APPLIED.md - Fixed nested dependency builds
- ROOT-CAUSE-ANALYSIS.md - Analysis of session ID capture issues
- CONVERSATION-CHANGES-SUMMARY.md - Summary of conversation changes

**Key Decision:** Adopted "Real Session IDs" approach where:
- Client doesn't send session ID on first request
- Server creates real UUID session
- Client captures and reuses real session ID
- JWT validates on every request

---

### [2025-10-02-role-mappings/](2025-10-02-role-mappings/)

**Context:** Implementation of configurable role mappings for flexible role determination

**Files:**
- CONFIGURABLE-ROLE-MAPPINGS.md - Documents configurable role mapping feature
- ROLE-DETERMINATION-EXPLAINED.md - Explains role determination logic
- CRITICAL-FORK-FIXES-NEEDED.md - Misconception that forks needed fixes
- NPM-PACKAGES-RESTORED.md - Switched back to npm packages

**Key Changes:**
- Made role mappings configurable (not hardcoded)
- Added roleMappings to IDPConfigSchema
- Updated determinePrimaryRole() to accept roleMappings parameter
- Discovered npm packages already had all OAuth features

---

## Historical Timeline

**Sep 30, 2025** - Initial OAuth stateless authentication implementation
- Discovered need for per-request authentication
- Fixed CORS headers for Authorization
- Implemented stateless session management
- Initially thought these were "patches" to node_modules

**Oct 1, 2025** - Session ID handling evolution
- Switched from "stateless-session" dummy to real session IDs
- Fixed client to not send session ID on first request
- Verified server returns real UUID sessions
- Confirmed GitHub forks had all features

**Oct 2, 2025** - Role mappings and npm verification
- Implemented configurable role mappings
- Verified npm packages (mcp-proxy@5.8.0, fastmcp@3.19.0) have ALL features
- Discovered "patches" were already in official npm releases
- Consolidated documentation and archived historical files

---

## Key Learnings

### 1. npm Packages Are Sufficient
No need for GitHub forks or manual patches. The npm packages mcp-proxy@5.8.0 and fastmcp@3.19.0 contain all OAuth stateless features.

### 2. Session ID Strategy: Real Session IDs
The correct approach is:
- Client doesn't send Mcp-Session-Id on first request
- Server creates real UUID session
- Client captures from response header
- Client sends real session ID on subsequent requests

### 3. Role Mappings Should Be Configurable
As a framework (not a solution), role mappings must be configurable to support different IDP claim structures.

---

## Why Archived?

These documents were created during active development and debugging. They show the evolution of understanding but contain:
- ❌ Contradictory information (multiple approaches documented)
- ❌ Outdated assumptions (thinking npm packages lacked features)
- ❌ Debugging artifacts (trial and error attempts)
- ❌ Duplicate information (same concepts explained multiple times)

**Current documentation** is consolidated, accurate, and reflects the final working implementation.

---

## Reference Only

Use these documents for:
- ✅ Understanding the development history
- ✅ Learning from debugging approaches
- ✅ Understanding why certain decisions were made

Do NOT use these for:
- ❌ Implementation guidance (use current docs instead)
- ❌ Configuration examples (may be outdated)
- ❌ Troubleshooting (use current docs instead)

---

## Current Documentation

For up-to-date information, always refer to:

1. **[../NPM-LIBRARY-VERIFICATION.md](../NPM-LIBRARY-VERIFICATION.md)**
   - Confirms npm packages have all OAuth features
   - Lists exact code locations verified
   - Documents current session ID approach

2. **[../../CLAUDE.md](../../CLAUDE.md)**
   - Main development guide for Claude Code
   - Architecture overview
   - Common commands and patterns

3. **[../../README.md](../../README.md)**
   - Project overview
   - Setup instructions
   - Current status and roadmap
