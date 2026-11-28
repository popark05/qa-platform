-- Case-level provenance for Test Cases generated from an approved Wireflow Review flow
-- (flow-model v1: sourceSystem, contractVersion, flowId, flowVersion, applicationId, approvalReviewId).
-- Step-level edge/transition references live inside qa_test_case_version.steps.
ALTER TABLE qa_test_case ADD COLUMN flow_ref JSONB;
