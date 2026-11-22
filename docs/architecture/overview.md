# QA Platform — Architecture Baseline

## Domain ownership
QA Platform owns Test Case, Test Case Version, Test Step, Assertion, Test Suite, Test Plan, Test Run, Step Result, Assertion Result, and execution reporting.

It consumes Application, Application Version, Screen, Transition, and Flow contracts from Reverse Screen or approved planning artifacts from Wireflow Review. It does not own runtime discovery sessions.

## Core domain rules
- **Flow != Test Case.** A flow represents product behavior; a test case verifies an objective.
- **Version immutability.** Published test versions are immutable. Changes create a new version.
- **Human approval.** AI-generated tests start in pending; AI confidence is not approval.
- **Execution provenance.** Every run identifies the exact test-case version, app version, target, adapter, and environment.
- **Normalized results.** Persist semantic action, normalized status, timing, and evidence references. Keep engine-specific objects in adapters.

## Initial aggregates
| Aggregate | Main entities |
|---|---|
| Test Definition | Test Case, Test Case Version, Test Step, Assertion |
| Organization | Test Suite, Test Plan |
| Execution | Test Run, Step Result, Assertion Result, Execution Event |
| Evidence | Evidence metadata, Evidence Link |
| AI Governance | Generation provenance, Review Record |

## Adapter contract
The application service should depend on a stable execution port. Initial adapters:
- Playwright for web.
- Mobilewright for Android/iOS and supported hybrid flows.
- Optional MobileCLI integration for device setup, logs, screenshots, and inspection.

The contract should normalize navigate, tap, fill, back, wait, assert, screenshot, and log collection. Adapter-specific locators and capabilities must be explicit.

## Storage
PostgreSQL is the initial relational-store choice. Evidence bytes (screenshots, videos, traces) belong in S3-compatible object storage; the database stores URI, hash, MIME type, and metadata.

The existing SQL draft is a cross-product v1 design baseline, not a production-ready migration. Before production, split database ownership by service boundary and add tenant isolation, authorization, audit/retention, and stronger foreign-key integrity.

## API and contract boundary
The first API contract covers Applications, Screens, Flows, Discovery, Test Cases, and Test Runs. QA Platform should consume Reverse Screen contracts through versioned JSON Schema/OpenAPI and explicit import/API workflows. Avoid shared database access.

## Implementation milestones
1. Refine QA aggregates and lifecycle states.
2. Finalize API and JSON Schema contracts.
3. Implement test authoring/version/review endpoints.
4. Implement execution adapter port and Playwright adapter.
5. Implement Mobilewright adapter and hybrid handoff handling.
6. Persist Test Runs, Step Results, Assertion Results, and Evidence metadata.
7. Add reporting, coverage, and integration tests.

## Initial status vocabularies
- Test review: pending, approved, rejected, needs_changes.
- Test run: queued, running, passed, failed, error, cancelled, skipped.
- AI generation: queued, running, completed, failed.