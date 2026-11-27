CREATE TABLE IF NOT EXISTS qa_test_run (
  run_id UUID PRIMARY KEY,
  test_case_id UUID NOT NULL,
  test_case_version INTEGER NOT NULL CHECK (test_case_version > 0),
  platform TEXT NOT NULL CHECK (platform IN ('web', 'android', 'ios', 'hybrid')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'running' AND finished_at IS NULL) OR (status <> 'running' AND finished_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS qa_test_run_test_case_started_idx
  ON qa_test_run (test_case_id, started_at DESC);

CREATE TABLE IF NOT EXISTS qa_step_result (
  run_id UUID NOT NULL REFERENCES qa_test_run(run_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  message TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_id),
  UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS qa_step_evidence_reference (
  run_id UUID NOT NULL,
  step_id TEXT NOT NULL,
  source_system TEXT NOT NULL CHECK (source_system = 'reverse-screen'),
  evidence_id UUID NOT NULL,
  contract_version TEXT NOT NULL CHECK (contract_version = '1.0'),
  kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'video', 'dom_snapshot', 'accessibility_tree', 'log', 'network_trace')),
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  storage_uri TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_id, source_system, evidence_id),
  FOREIGN KEY (run_id, step_id) REFERENCES qa_step_result(run_id, step_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS qa_step_evidence_id_idx
  ON qa_step_evidence_reference (evidence_id);
