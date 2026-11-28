# Reverse Screen evidence integration

QA Platform stores an immutable reference to an evidence artifact; Reverse Screen remains the system of record for the artifact metadata and binary object. QA Platform does not write to Reverse Screen's database or copy the binary.

## Contract

The normalized step-level reference is defined by `contracts/reverse-screen-evidence-reference.v1.schema.json`. Version 1.0 contains the source system, evidence ID, kind, content type, size, SHA-256, stable storage URI and capture time. It intentionally excludes presigned URLs because those are short-lived credentials, not durable identifiers.

## Resolution and attachment

1. QA Platform receives `POST /v1/test-runs/{runId}/steps/{stepId}/evidence` with an `evidenceId`.
2. Its `ReverseScreenEvidenceClient` calls `GET {REVERSE_SCREEN_BASE_URL}/v1/evidence-artifacts/{evidenceId}` with `Authorization: Bearer <REVERSE_SCREEN_SERVICE_TOKEN>`.
3. QA Platform validates the returned metadata and maps it to contract v1.0.
4. It requests a fresh signed download URL with the service token, downloads the binary without forwarding the token, and checks content type, byte size, a 20 MiB maximum, and SHA-256.
5. `TestRunService` attaches the reference to the selected Step Result, deduplicated by `sourceSystem + evidenceId`.
6. The reference is returned with `GET /v1/test-runs/{runId}`.

A consumer that needs binary access must request a fresh download URL from Reverse Screen's `GET /v1/evidence-artifacts/{evidenceId}/download-url` endpoint. QA Platform never stores that temporary URL.

## Persistence

- When `DATABASE_URL` is configured, `TestRunService` uses `PostgresTestRunRepository`. Test Runs, Step Results, heartbeats, and step-level Evidence references are persisted in PostgreSQL.
- Run the database migrations with `npm run migrate` before starting the service. The server also uses PostgreSQL-backed Test Case persistence when the database is configured.
- Without `DATABASE_URL`, the service falls back to in-memory repositories. Data, including Evidence references, is then lost on process restart.
- The PostgreSQL repository scopes reads and writes by `tenant_id`; the API tenant identity is derived from the authenticated request context.

## Current limitations

- The metadata client requires a high-entropy shared service token of at least 32 bytes. Reverse Screen must be configured with the same token to authorize metadata and download-URL requests; those endpoints fail closed when verification is not configured. Keep the token in deployment secret storage and rotate it in both services together.
- The client buffers only bounded chunks while verifying the binary; it does not persist evidence bytes or signed download URLs. The current maximum is 20 MiB per evidence item.
- Presigned download URLs are intentionally generated on demand by Reverse Screen rather than stored in QA Platform.
