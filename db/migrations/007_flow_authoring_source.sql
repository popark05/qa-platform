-- Test Cases generated from an approved Wireflow Review flow use source 'flow'.
-- They start as draft like manual cases and must still pass human review before execution.
-- The inline CHECK constraints from 002 carry PostgreSQL's default names.
ALTER TABLE qa_test_case DROP CONSTRAINT IF EXISTS qa_test_case_source_check;
ALTER TABLE qa_test_case ADD CONSTRAINT qa_test_case_source_check CHECK (source IN ('manual', 'ai', 'flow'));
ALTER TABLE qa_test_case_version DROP CONSTRAINT IF EXISTS qa_test_case_version_source_check;
ALTER TABLE qa_test_case_version ADD CONSTRAINT qa_test_case_version_source_check CHECK (source IN ('manual', 'ai', 'flow'));
