-- Development only. Creates a least-privilege split:
--   erp_owner  owns the schema and runs migrations
--   erp_app    used by the running application: DML only, no DDL
-- Passwords here are local placeholders; never reuse them elsewhere.

CREATE ROLE erp_owner LOGIN PASSWORD 'owner_dev_password';
CREATE ROLE erp_app LOGIN PASSWORD 'app_dev_password';

CREATE DATABASE erp_dev OWNER erp_owner;
CREATE DATABASE erp_test OWNER erp_owner;

\connect erp_dev
ALTER SCHEMA public OWNER TO erp_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
