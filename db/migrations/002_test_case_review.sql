CREATE TABLE IF NOT EXISTS qa_test_case (
  test_case_id UUID PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_test_case_version (
  test_case_id UUID NOT NULL REFERENCES qa_test_case(test_case_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  title VARCHAR(240) NOT NULL CHECK (title <> ''),
  description VARCHAR(4000),
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
  steps JSONB NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) > 0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (test_case_id, version)
);

ALTER TABLE qa_test_run
  ADD CONSTRAINT qa_test_run_test_case_version_fk
  FOREIGN KEY (test_case_id, test_case_version)
  REFERENCES qa_test_case_version(test_case_id, version)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS qa_test_case_status_updated_idx
  ON qa_test_case (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS qa_test_case_submission (
  submission_id UUID PRIMARY KEY,
  test_case_id UUID NOT NULL,
  version INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (test_case_id, version)
    REFERENCES qa_test_case_version(test_case_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS qa_test_case_submission_case_idx
  ON qa_test_case_submission (test_case_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS qa_test_case_review (
  review_id UUID PRIMARY KEY,
  test_case_id UUID NOT NULL,
  version INTEGER NOT NULL,
  reviewer_id VARCHAR(200) NOT NULL CHECK (reviewer_id <> ''),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment VARCHAR(4000),
  reviewed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (test_case_id, version),
  FOREIGN KEY (test_case_id, version)
    REFERENCES qa_test_case_version(test_case_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS qa_test_case_review_case_idx
  ON qa_test_case_review (test_case_id, reviewed_at DESC);
