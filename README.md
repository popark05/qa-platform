# QA Platform

QA Platform manages test intent and execution for web, mobile, and hybrid applications. It consumes application and flow models discovered or authored elsewhere, then turns approved behavior into repeatable verification.

## Product responsibilities
- Manage applications, versions, and execution targets.
- Author test cases manually and generate candidate tests with AI.
- Version test cases and require human review before approval.
- Organize test cases into suites and plans.
- Execute tests through engine adapters and persist normalized results.
- Attach evidence and report step, assertion, and transition coverage.

## Supported execution direction
- Web: Playwright.
- Native Android/iOS: Mobilewright.
- Hybrid: native Mobilewright and web Playwright capabilities are separate; explicit context-aware orchestration is not implemented yet.

## Development

- Node.js 22.12+
- Install dependencies: `npm install`
- Run checks: `npm run typecheck && npm test && npm run build`

The default execution adapter is a mock implementation.

### PostgreSQL persistence

Set `DATABASE_URL` to persist Test Cases, immutable Test Case Versions, submissions, Review Records, Test Runs, ordered Step Results, and Evidence References in PostgreSQL. Apply migrations before starting the API:

```bash
DATABASE_URL=postgres://qa:qa@localhost:5432/qa_platform npm run migrate
DATABASE_URL=postgres://qa:qa@localhost:5432/qa_platform npm start
```

When `DATABASE_URL` is omitted, the API uses in-memory repositories.

Test Case API:
- `POST /v1/test-cases` creates version 1. AI-authored cases enter `pending_review` and receive an initial submission record.
- `GET /v1/test-cases` and `GET /v1/test-cases/{testCaseId}` return the current version.
- `POST /v1/test-cases/{testCaseId}/submissions` submits the current draft. An optional `expectedVersion` provides optimistic concurrency protection.
- `POST /v1/test-cases/{testCaseId}/reviews` records a human decision against the current version. An optional `expectedVersion` prevents stale review decisions.
- `GET /v1/test-cases/{testCaseId}/reviews` returns the version-bound review history.
- `POST /v1/test-cases/{testCaseId}/versions` creates a new draft from a complete replacement snapshot. The request must include `expectedVersion`; the current version is never edited in place. A new version must be submitted and approved before execution.

The database stores each version as a separate row keyed by `(test_case_id, version)`. The repository exposes insert-only version creation and no update/delete operation for version content. Submission and review transitions lock the aggregate row and verify the expected version in one transaction. Test Runs have a composite foreign key to the exact Test Case Version they execute, so later edits do not change historical run provenance.

A Test Run is inserted with status `running` before the first step starts. Each Step Result is committed independently in execution order. The final status (`passed` or `failed`) and finish time are committed after execution. Active executions refresh `last_heartbeat_at` every 10 seconds and after each persisted step. A PostgreSQL-backed recovery worker runs at startup and periodically, atomically marking runs whose heartbeat is older than the configured threshold as `abandoned`. Recovery uses `FOR UPDATE SKIP LOCKED`, so multiple API instances can safely run the worker concurrently. Abandoned runs retain their completed step results and are terminal; they are not silently retried.

Recovery settings:
- `QA_RUN_STALE_AFTER_SECONDS` (default `120`, minimum `30`): heartbeat age after which a running Test Run is considered abandoned.
- `QA_RUN_RECOVERY_INTERVAL_MS` (default `30000`, minimum `5000`): recovery scan interval.

The in-memory repository does not persist runs across process restarts and its recovery operation is intentionally a no-op.

### Authentication, authorization and tenant isolation

Production mode requires a signed HS256 JWT on every API route except `/health`. Configure:

- `QA_AUTH_JWT_SECRET`: at least 32 bytes of high-entropy secret material.
- `QA_AUTH_ISSUER`: exact expected JWT `iss` claim (required in production).
- `QA_AUTH_AUDIENCE`: exact expected JWT `aud` value (required in production).
- `QA_AUTH_REQUIRED=true`: enables required authentication outside production too.

The API validates the signature, algorithm, expiry, optional not-before time, issuer, audience, subject, tenant UUID, and role claims. Tokens use claims `sub`, `tenant_id`, `roles`, `exp`, `iss`, and `aud`. Supported roles are `admin`, `author`, `reviewer`, `executor`, and `viewer`. The authenticated subject, not the client-supplied reviewer field, is recorded as the reviewer identity.

Authorization boundaries:
- `author`: create, submit, and version Test Cases.
- `reviewer`: approve or reject submitted Test Cases.
- `executor`: execute approved Test Cases and attach evidence.
- `viewer`: read Test Cases and Test Runs.
- `admin`: all of the above.

Test Case and Test Run repository operations are tenant-scoped. PostgreSQL stores `tenant_id` on both aggregates, enforces tenant existence, and enforces that a Test Run's tenant matches its Test Case. Cross-tenant lookups return not found rather than disclosing resource existence. Tenant IDs come only from the verified token; request payloads cannot select a tenant.

Migration `005_tenant_isolation.sql` creates the default development tenant and backfills existing records into it. Provision additional tenants through a controlled database administration process, for example:

```sql
INSERT INTO qa_tenant (tenant_id, name)
VALUES ('<new-tenant-uuid>', '<tenant-name>');
```

The identity/token issuer must then issue tokens with that tenant UUID. Do not use the development authentication mode on a publicly reachable deployment: outside production it is disabled by default for local development unless `QA_AUTH_REQUIRED=true`.

### Web execution

```bash
npx playwright install chromium
QA_EXECUTION_ADAPTER=playwright PLAYWRIGHT_BROWSER=chromium npm start
```

### Native mobile execution

Install Android SDK/JDK and boot an emulator or connect a device, or use macOS with Xcode for iOS. Run `npx mobilewright doctor` to verify the toolchain.

```bash
MOBILE_APP_BUNDLE_ID=com.example.app QA_EXECUTION_ADAPTER=mobilewright npm start
```

Submit runs with `platform: "android"` or `platform: "ios"`; `targetId` is the selected device ID/UDID. The app must already be installed. The adapter supports semantic native locators (`role`, `text`, `label`, `testId`) and bounded actions documented in [the adapter contract](docs/architecture/adapter-contract.md). It rejects CSS/XPath and arbitrary script execution on native screens.

Free-form test step `instruction` is descriptive only. Real execution requires a structured JSON `action`. AI-authored cases remain pending until human review.

## Reverse Screen evidence integration

Configure `REVERSE_SCREEN_BASE_URL` to enable step-level evidence references:

```bash
REVERSE_SCREEN_BASE_URL=http://localhost:3000 npm start
```

After a Test Run is created, attach an evidence artifact owned by Reverse Screen:

```http
POST /v1/test-runs/{runId}/steps/{stepId}/evidence
Content-Type: application/json

{ "evidenceId": "reverse-screen-evidence-uuid" }
```

QA Platform resolves metadata through Reverse Screen's versioned `/v1/evidence-artifacts/{evidenceId}` API, validates it, and attaches a versioned reference to the Step Result. Retrieve the updated run with `GET /v1/test-runs/{runId}`. Duplicate attachments are idempotent.

The contract is defined in [reverse-screen-evidence-reference.v1.schema.json](contracts/reverse-screen-evidence-reference.v1.schema.json). QA Platform stores only stable evidence metadata references, never binary bytes or temporary presigned URLs. To access the binary, a client requests a fresh download URL from Reverse Screen.

See [evidence integration architecture](docs/architecture/evidence-integration.md) for the request flow and current boundaries.

### Native Mobilewright E2E validation

The `Mobilewright Native E2E` workflow builds small native fixture apps and drives them on real Android and iOS simulator runtimes. It does not substitute a browser/WebView test for native coverage.

- Android: builds a debug APK with Gradle, installs it on an API 35 Android emulator, and exercises the Email field, Continue button, and Welcome result.
- iOS: builds a SwiftUI simulator app with Xcode, installs it on an iPhone simulator, and runs the same semantic interaction sequence.
- Both jobs run `scripts/mobilewright-smoke.mjs` through the Mobilewright Android/iOS launch APIs after installing the fixture app.

The workflow runs on pushes and pull requests that change the Mobilewright adapter, fixtures, smoke script, or package dependencies, and can also be started manually. It validates simulator/emulator integration; physical-device certification still requires a connected device lab and platform signing/provisioning.

## Repository boundaries
- [Wireflow Review](https://github.com/popark05/wireflow-review) owns planning-time flow review.
- [Reverse Screen](https://github.com/popark05/reverse-screen) owns runtime discovery and screen/flow models.
- QA Platform owns test authoring, execution, result persistence, and reporting.
- Cross-repository communication uses versioned contracts and APIs. No product writes directly to another product's database.

## Current limitations
- Test Case Version content is immutable through the repository/API contract, but database-level mutation guards and retention/archival controls are not yet installed.
- Test Case, Review Record, and Test Run persistence require PostgreSQL; otherwise data remains in-memory.
- Playwright execution is opt-in and requires browser installation in the runtime image.
- Mobilewright adapter is implemented with unit/fake-driver tests; physical device and simulator E2E execution has not yet been validated in CI.
- Hybrid WebView/native context switching, automatic APK/IPA installation, authentication, tenant isolation and retention policies are not implemented. Evidence references are stored as relational rows linked to Step Results when PostgreSQL is enabled.

## Core rules
1. Flow and Test Case are distinct aggregates.
2. Published Test Case versions are immutable; edits create a new version.
3. AI-generated tests remain pending until human review.
4. A successful runtime observation is not equivalent to human approval.
5. Test Run, Step Result, and Assertion Result are persisted independently.

## License
To be decided before public distribution.
