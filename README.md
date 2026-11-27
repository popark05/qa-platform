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

## Repository boundaries
- [Wireflow Review](https://github.com/popark05/wireflow-review) owns planning-time flow review.
- [Reverse Screen](https://github.com/popark05/reverse-screen) owns runtime discovery and screen/flow models.
- QA Platform owns test authoring, execution, result persistence, and reporting.
- Cross-repository communication uses versioned contracts and APIs. No product writes directly to another product's database.

## Current limitations
- Test cases and test runs are currently in-memory; PostgreSQL persistence is a subsequent milestone.
- Playwright execution is opt-in and requires browser installation in the runtime image.
- Mobilewright adapter is implemented with unit/fake-driver tests; physical device and simulator E2E execution has not yet been validated in CI.
- Hybrid WebView/native context switching, automatic APK/IPA installation, authentication, tenant isolation and retention policies are not implemented. Evidence references are attached to in-memory Test Runs; durable persistence is still pending.

## Core rules
1. Flow and Test Case are distinct aggregates.
2. Published Test Case versions are immutable; edits create a new version.
3. AI-generated tests remain pending until human review.
4. A successful runtime observation is not equivalent to human approval.
5. Test Run, Step Result, and Assertion Result are persisted independently.

## License
To be decided before public distribution.
