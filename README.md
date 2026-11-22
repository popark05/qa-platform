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
- Mobile and hybrid: Mobilewright, with MobileCLI as a device-control/inspection companion where appropriate.
- Adapter-specific runtime objects remain behind adapter interfaces.

## Development

- Node.js 22+
- Install dependencies: `npm install`
- Run checks: `npm run typecheck && npm test && npm run build`

The default execution adapter is a mock implementation. To enable managed Playwright execution:

```bash
npx playwright install chromium
QA_EXECUTION_ADAPTER=playwright PLAYWRIGHT_BROWSER=chromium npm start
```

Supported browser names are `chromium`, `firefox` and `webkit`. A fresh isolated BrowserContext is created per test run, while the browser process is reused. The context is closed after the run. The service closes browser processes on shutdown.

Test steps executed by Playwright must contain a structured JSON `action`. Supported actions and locator grammar are documented in [the adapter contract](docs/architecture/adapter-contract.md). Free-form instructions are not interpreted as executable code.

## Repository boundaries
- [Wireflow Review](https://github.com/popark05/wireflow-review) owns planning-time flow review.
- [Reverse Screen](https://github.com/popark05/reverse-screen) owns runtime discovery and screen/flow models.
- QA Platform owns test authoring, execution, result persistence, and reporting.
- Cross-repository communication uses versioned contracts and APIs. No product writes directly to another product's database.

## Current limitations
- Test cases and test runs are currently in-memory; PostgreSQL persistence is a subsequent milestone.
- Playwright execution is opt-in and requires browser installation in the runtime image.
- Mobilewright adapter and device/session provisioning are not implemented yet.
- Evidence binary storage, authentication, tenant isolation and retention policies are not implemented.

## Core rules
1. Flow and Test Case are distinct aggregates.
2. Published Test Case versions are immutable; edits create a new version.
3. AI-generated tests remain pending until human review.
4. A successful runtime observation is not equivalent to human approval.
5. Test Run, Step Result, and Assertion Result are persisted independently.

## License
To be decided before public distribution.