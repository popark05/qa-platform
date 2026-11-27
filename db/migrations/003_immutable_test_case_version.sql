-- Test Case Version rows are append-only. Lifecycle state belongs to qa_test_case.
CREATE OR REPLACE FUNCTION qa_reject_test_case_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'qa_test_case_version_is_immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS qa_test_case_version_immutable_update ON qa_test_case_version;
CREATE TRIGGER qa_test_case_version_immutable_update
BEFORE UPDATE ON qa_test_case_version
FOR EACH ROW EXECUTE FUNCTION qa_reject_test_case_version_mutation();

DROP TRIGGER IF EXISTS qa_test_case_version_immutable_delete ON qa_test_case_version;
CREATE TRIGGER qa_test_case_version_immutable_delete
BEFORE DELETE ON qa_test_case_version
FOR EACH ROW EXECUTE FUNCTION qa_reject_test_case_version_mutation();
