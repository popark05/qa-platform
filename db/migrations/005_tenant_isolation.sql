CREATE TABLE IF NOT EXISTS qa_tenant (
  tenant_id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO qa_tenant (tenant_id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default development tenant')
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE qa_test_case ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE qa_test_case SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE qa_test_case ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE qa_test_case
  ADD CONSTRAINT qa_test_case_tenant_fk FOREIGN KEY (tenant_id)
  REFERENCES qa_tenant(tenant_id) ON DELETE RESTRICT;
ALTER TABLE qa_test_case
  ADD CONSTRAINT qa_test_case_tenant_case_unique UNIQUE (tenant_id, test_case_id);

ALTER TABLE qa_test_run ADD COLUMN IF NOT EXISTS tenant_id UUID;
-- All records predating tenant partitioning were assigned to the default tenant above.
UPDATE qa_test_run SET tenant_id = '00000000-0000-4000-8000-000000000001'
WHERE tenant_id IS NULL;
ALTER TABLE qa_test_run ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE qa_test_run
  ADD CONSTRAINT qa_test_run_tenant_case_fk
  FOREIGN KEY (tenant_id, test_case_id)
  REFERENCES qa_test_case(tenant_id, test_case_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS qa_test_case_tenant_updated_idx
  ON qa_test_case (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS qa_test_run_tenant_started_idx
  ON qa_test_run (tenant_id, started_at DESC);
