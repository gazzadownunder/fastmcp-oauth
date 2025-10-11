-- PostgreSQL Role Setup for MCP OAuth Testing
-- Run this script as the postgres superuser

-- ============================================================================
-- Create Test Roles
-- ============================================================================

-- Alice (Admin role with full permissions)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ALICE_ADMIN') THEN
        CREATE ROLE "ALICE_ADMIN" LOGIN PASSWORD 'AlicePass123!';
        RAISE NOTICE 'Created role ALICE_ADMIN';
    ELSE
        RAISE NOTICE 'Role ALICE_ADMIN already exists';
    END IF;
END
$$;

-- Bob (Read-only role)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'BOB_USER') THEN
        CREATE ROLE "BOB_USER" LOGIN PASSWORD 'BobPass123!';
        RAISE NOTICE 'Created role BOB_USER';
    ELSE
        RAISE NOTICE 'Role BOB_USER already exists';
    END IF;
END
$$;

-- Carol (Guest role with minimal permissions)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'CAROL_GUEST') THEN
        CREATE ROLE "CAROL_GUEST" LOGIN PASSWORD 'CarolPass123!';
        RAISE NOTICE 'Created role CAROL_GUEST';
    ELSE
        RAISE NOTICE 'Role CAROL_GUEST already exists';
    END IF;
END
$$;

-- ============================================================================
-- Grant Basic Database Access
-- ============================================================================

-- All roles need to connect to the database
GRANT CONNECT ON DATABASE postgres TO "ALICE_ADMIN", "BOB_USER", "CAROL_GUEST";

-- All roles need usage on public schema
GRANT USAGE ON SCHEMA public TO "ALICE_ADMIN", "BOB_USER", "CAROL_GUEST";

-- ============================================================================
-- ALICE_ADMIN - Full Permissions
-- ============================================================================

-- Grant all privileges on existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "ALICE_ADMIN";

-- Grant all privileges on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "ALICE_ADMIN";

-- Grant sequence privileges (for auto-increment columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "ALICE_ADMIN";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO "ALICE_ADMIN";

-- Grant function execution
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "ALICE_ADMIN";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO "ALICE_ADMIN";

-- ============================================================================
-- BOB_USER - Read-Only Permissions
-- ============================================================================

-- Grant select on existing tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "BOB_USER";

-- Grant select on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO "BOB_USER";

-- Grant sequence select (needed to see sequence values)
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO "BOB_USER";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO "BOB_USER";

-- ============================================================================
-- CAROL_GUEST - Minimal Permissions (Schema Info Only)
-- ============================================================================

-- Carol can only see table structures, not data
-- This is already handled by USAGE on schema

-- ============================================================================
-- Create Test Table (Optional)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'test_data') THEN
        CREATE TABLE public.test_data (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Insert sample data
        INSERT INTO public.test_data (username, data) VALUES
            ('alice', 'Alice admin data'),
            ('bob', 'Bob user data'),
            ('carol', 'Carol guest data');

        RAISE NOTICE 'Created test_data table with sample data';
    ELSE
        RAISE NOTICE 'Table test_data already exists';
    END IF;
END
$$;

-- ============================================================================
-- Grant Permissions on Test Table
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.test_data TO "ALICE_ADMIN";
GRANT USAGE, SELECT ON SEQUENCE public.test_data_id_seq TO "ALICE_ADMIN";

GRANT SELECT ON TABLE public.test_data TO "BOB_USER";
GRANT SELECT ON SEQUENCE public.test_data_id_seq TO "BOB_USER";

-- Carol gets no explicit permissions (can only see schema info)

-- ============================================================================
-- Display Role Permissions
-- ============================================================================

\echo '============================================================================'
\echo 'Role Setup Complete!'
\echo '============================================================================'
\echo ''
\echo 'Created Roles:'
\echo '  - ALICE_ADMIN (Full permissions: SELECT, INSERT, UPDATE, DELETE)'
\echo '  - BOB_USER (Read-only: SELECT)'
\echo '  - CAROL_GUEST (Schema info only: no table access)'
\echo ''
\echo 'Test Table: public.test_data'
\echo '  - 3 sample rows inserted'
\echo ''
\echo 'You can now test with these roles using the MCP OAuth server.'
\echo '============================================================================'

-- ============================================================================
-- Verification Queries (Optional)
-- ============================================================================

-- List all roles and their attributes
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin
FROM pg_roles
WHERE rolname IN ('ALICE_ADMIN', 'BOB_USER', 'CAROL_GUEST')
ORDER BY rolname;

-- List table privileges for test roles
SELECT
    grantee,
    table_schema,
    table_name,
    string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE grantee IN ('ALICE_ADMIN', 'BOB_USER', 'CAROL_GUEST')
    AND table_schema = 'public'
GROUP BY grantee, table_schema, table_name
ORDER BY grantee, table_name;
