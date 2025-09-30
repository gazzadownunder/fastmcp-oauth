-- Seed test data for OAuth OBO testing

USE test_legacy_app;
GO

-- Insert test users
SET IDENTITY_INSERT Users ON;
GO

IF NOT EXISTS (SELECT * FROM Users WHERE id = 1)
BEGIN
    INSERT INTO Users (id, username, email, department, role, legacy_sam_account)
    VALUES (1, 'testuser', 'testuser@company.com', 'Engineering', 'developer', 'TESTDOMAIN\testuser');
    PRINT 'Test user 1 inserted';
END
GO

IF NOT EXISTS (SELECT * FROM Users WHERE id = 2)
BEGIN
    INSERT INTO Users (id, username, email, department, role, legacy_sam_account)
    VALUES (2, 'adminuser', 'admin@company.com', 'IT', 'admin', 'TESTDOMAIN\adminuser');
    PRINT 'Test user 2 inserted';
END
GO

IF NOT EXISTS (SELECT * FROM Users WHERE id = 3)
BEGIN
    INSERT INTO Users (id, username, email, department, role, legacy_sam_account)
    VALUES (3, 'guestuser', 'guest@company.com', 'Marketing', 'guest', 'TESTDOMAIN\guestuser');
    PRINT 'Test user 3 inserted';
END
GO

SET IDENTITY_INSERT Users OFF;
GO

-- Insert test documents
SET IDENTITY_INSERT Documents ON;
GO

IF NOT EXISTS (SELECT * FROM Documents WHERE id = 1)
BEGIN
    INSERT INTO Documents (id, title, content, owner_id, department)
    VALUES (1, 'Engineering Spec', 'Technical specification document', 1, 'Engineering');
    PRINT 'Test document 1 inserted';
END
GO

IF NOT EXISTS (SELECT * FROM Documents WHERE id = 2)
BEGIN
    INSERT INTO Documents (id, title, content, owner_id, department)
    VALUES (2, 'IT Policy', 'Corporate IT security policy', 2, 'IT');
    PRINT 'Test document 2 inserted';
END
GO

IF NOT EXISTS (SELECT * FROM Documents WHERE id = 3)
BEGIN
    INSERT INTO Documents (id, title, content, owner_id, department)
    VALUES (3, 'Marketing Plan', 'Q1 marketing strategy', 3, 'Marketing');
    PRINT 'Test document 3 inserted';
END
GO

SET IDENTITY_INSERT Documents OFF;
GO

PRINT 'Sample data seeding complete';
GO

-- Verify data
SELECT 'Users' AS TableName, COUNT(*) AS RecordCount FROM Users
UNION ALL
SELECT 'Documents', COUNT(*) FROM Documents;
GO

-- Show sample data
SELECT id, username, department, role, legacy_sam_account FROM Users;
SELECT id, title, department, owner_id FROM Documents;
GO