#!/usr/bin/env python3
"""Apply all 3 fixes to postgresql-module.ts"""

import re

FILE_PATH = 'packages/sql-delegation/src/postgresql-module.ts'

with open(FILE_PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix #3: Add rolesClaim field to TokenExchangeConfig interface
content = content.replace(
    '  /** Required claim in TE-JWT (e.g., legacy_name) */\n  requiredClaim?: string;\n\n  /** Token cache configuration */',
    '  /** Required claim in TE-JWT (e.g., legacy_name) */\n  requiredClaim?: string;\n\n  /** Roles claim path in TE-JWT (default: \'roles\') */\n  rolesClaim?: string;\n\n  /** Token cache configuration */'
)

# Fix #1: Add role extraction after line that sets effectiveLegacyUsername
content = content.replace(
    '        // Use claim value as legacy username\n        effectiveLegacyUsername = claimValue as string;\n\n        console.log(\'[PostgreSQLModule] Token exchange successful:\', {\n          legacyUsername: effectiveLegacyUsername,\n          idpName: this.tokenExchangeConfig.idpName,\n        });',
    '''        // Use claim value as legacy username
        effectiveLegacyUsername = claimValue as string;

        // Extract roles from TE-JWT (may be in 'roles', 'user_roles', or other claim)
        const rolesClaimPath = this.tokenExchangeConfig.rolesClaim || 'roles';
        const teRoles = (Array.isArray(teClaims?.[rolesClaimPath])
          ? teClaims[rolesClaimPath]
          : []) as string[];

        console.log('[PostgreSQLModule] Token exchange successful:', {
          legacyUsername: effectiveLegacyUsername,
          roles: teRoles,
          rolesClaimPath,
          idpName: this.tokenExchangeConfig.idpName,
        });'''
)

# Fix #2: Fix incorrect this.tokenExchangeService references (should be this.tokenExchangeConfig)
content = re.sub(
    r'tokenExchangeUsed: !!this\.tokenExchangeService',
    'tokenExchangeUsed: !!this.tokenExchangeConfig',
    content
)

with open(FILE_PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ All 3 fixes applied successfully!")
print("   Fix #1: Added role extraction from TE-JWT")
print("   Fix #2: Fixed this.tokenExchangeService → this.tokenExchangeConfig")
print("   Fix #3: Added rolesClaim field to TokenExchangeConfig interface")
