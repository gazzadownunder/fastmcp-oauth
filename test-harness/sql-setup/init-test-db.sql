-- Create test database for OAuth OBO testing
-- This script initializes the test environment

-- Create database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'test_legacy_app')
BEGIN
    CREATE DATABASE test_legacy_app;
    PRINT 'Database test_legacy_app created';
END
ELSE
BEGIN
    PRINT 'Database test_legacy_app already exists';
END
GO

USE test_legacy_app;
GO

-- Create test tables
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[Users] (
        id INT PRIMARY KEY IDENTITY(1,1),
        username NVARCHAR(100) NOT NULL,
        email NVARCHAR(255),
        department NVARCHAR(100),
        role NVARCHAR(50),
        legacy_sam_account NVARCHAR(255),
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE()
    );
    PRINT 'Table Users created';
END
ELSE
BEGIN
    PRINT 'Table Users already exists';
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[AuditLog] (
        id INT PRIMARY KEY IDENTITY(1,1),
        user_id INT,
        action NVARCHAR(255) NOT NULL,
        resource NVARCHAR(255),
        success BIT,
        error_message NVARCHAR(MAX),
        timestamp DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (user_id) REFERENCES Users(id)
    );
    PRINT 'Table AuditLog created';
END
ELSE
BEGIN
    PRINT 'Table AuditLog already exists';
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Documents]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[Documents] (
        id INT PRIMARY KEY IDENTITY(1,1),
        title NVARCHAR(255) NOT NULL,
        content NVARCHAR(MAX),
        owner_id INT,
        department NVARCHAR(100),
        created_at DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (owner_id) REFERENCES Users(id)
    );
    PRINT 'Table Documents created';
END
ELSE
BEGIN
    PRINT 'Table Documents already exists';
END
GO

PRINT 'Test database initialization complete';
GO