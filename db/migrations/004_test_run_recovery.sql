ALTER TABLE qa_test_run
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE qa_test_run
  DROP CONSTRAINT IF EXISTS qa_test_run_status_check;

ALTER TABLE qa_test_run
  ADD CONSTRAINT qa_test_run_status_check
  CHECK (status IN ('running', 'passed', 'failed', 'abandoned'));

CREATE INDEX IF NOT EXISTS qa_test_run_stale_heartbeat_idx
  ON qa_test_run (last_heartbeat_at)
  WHERE status = 'running';
