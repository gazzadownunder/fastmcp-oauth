-- Create test users for EXECUTE AS testing
-- These users match the legacy_sam_account values from Keycloak JWT tokens

USE test_legacy_app;
GO

-- Create SQL users without login for EXECUTE AS
-- These correspond to domain users from legacy systems

-- Test User 1: Regular user
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'TESTDOMAIN\testuser')
BEGIN
    CREATE USER [TESTDOMAIN\testuser] WITHOUT LOGIN;
    PRINT 'User TESTDOMAIN\testuser created';
END
ELSE
BEGIN
    PRINT 'User TESTDOMAIN\testuser already exists';
END
GO

-- Test User 2: Admin user
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'TESTDOMAIN\adminuser')
BEGIN
    CREATE USER [TESTDOMAIN\adminuser] WITHOUT LOGIN;
    PRINT 'User TESTDOMAIN\adminuser created';
END
ELSE
BEGIN
    PRINT 'User TESTDOMAIN\adminuser already exists';
END
GO

-- Test User 3: Guest user (limited permissions)
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'TESTDOMAIN\guestuser')
BEGIN
    CREATE USER [TESTDOMAIN\guestuser] WITHOUT LOGIN;
    PRINT 'User TESTDOMAIN\guestuser created';
END
ELSE
BEGIN
    PRINT 'User TESTDOMAIN\guestuser already exists';
END
GO

-- Grant permissions

-- Regular user: Read and write to Users table
GRANT SELECT, INSERT, UPDATE ON Users TO [TESTDOMAIN\testuser];
GRANT SELECT ON Documents TO [TESTDOMAIN\testuser];
PRINT 'Permissions granted to TESTDOMAIN\testuser';
GO

-- Admin user: Full permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON Users TO [TESTDOMAIN\adminuser];
GRANT SELECT, INSERT, UPDATE, DELETE ON Documents TO [TESTDOMAIN\adminuser];
GRANT SELECT, INSERT ON AuditLog TO [TESTDOMAIN\adminuser];
PRINT 'Permissions granted to TESTDOMAIN\adminuser';
GO

-- Guest user: Read-only
GRANT SELECT ON Users TO [TESTDOMAIN\guestuser];
GRANT SELECT ON Documents TO [TESTDOMAIN\guestuser];
PRINT 'Permissions granted to TESTDOMAIN\guestuser';
GO

-- Grant IMPERSONATE permission to sa (needed for EXECUTE AS)
GRANT IMPERSONATE ON USER::[TESTDOMAIN\testuser] TO [sa];
GRANT IMPERSONATE ON USER::[TESTDOMAIN\adminuser] TO [sa];
GRANT IMPERSONATE ON USER::[TESTDOMAIN\guestuser] TO [sa];
PRINT 'IMPERSONATE permissions granted to sa';
GO

PRINT 'Test users configuration complete';
GO

-- Verify users were created
SELECT
    name AS UserName,
    type_desc AS UserType,
    create_date AS CreatedDate
FROM sys.database_principals
WHERE name LIKE 'TESTDOMAIN\%'
ORDER BY name;
GO