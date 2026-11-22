# Automation Adapter Contract v1.1

## Purpose
Provide one platform-neutral execution interface for Web (Playwright) and native Mobile (Mobilewright). Product/domain code must not depend on Playwright or Mobilewright classes.

## Core TypeScript contract

```ts
export type Platform = "web" | "android" | "ios" | "hybrid";

export interface ExecutionTarget {
  id: string;
  platform: Platform;
  kind: "browser" | "emulator" | "simulator" | "device" | "cloud_device";
  capabilities: Record<string, unknown>;
}

export interface Locator {
  strategy: "accessibility_id" | "role_name" | "text" | "test_id" | "css" | "xpath" | "ios_predicate" | "android_uiautomator" | "coordinate" | "custom";
  value: string;
  options?: Record<string, unknown>;
}
```

The normalized contract remains platform-neutral. Vendor locator/action objects must never be persisted.

## Playwright StepExecutor

The QA Platform includes an opt-in `PlaywrightStepExecutor`. It accepts a Playwright `Page` from the execution/session manager and maps a constrained JSON action grammar to Playwright locators and operations.

Supported web actions: `navigate`, `click`, `fill`, `press`, `assert_visible`, `assert_text`, and `wait_for`.
Supported web locator strategies: `role`, `text`, `testId`, and `css`.

## Mobilewright StepExecutor

The opt-in `MobilewrightStepExecutor` uses the documented `ios.launch()` / `android.launch()` API. The execution target's `targetId` is passed as Mobilewright's `deviceId`; `MOBILE_APP_BUNDLE_ID` identifies the application under test. A Mobilewright device connection is reused within a test run and closed at run completion or server shutdown.

Supported native mobile actions:
- `navigate`: opens a URL or deep link through `device.goto()`.
- `click`: resolves a native locator and calls `tap()`.
- `fill`: fills a native text field.
- `assert_visible` and `assert_text`: checks visibility or retrieved text.
- `wait_for`: waits for visible/hidden/enabled/disabled state.
- `swipe`: performs a directional screen swipe.

Supported native locator strategies:
- `role`: semantic role, optionally with `name` and `exact`.
- `text`: visible text, optionally exact.
- `label`: accessibility label.
- `testId`: accessibility identifier / test ID.

Example:

```json
{ "type": "click", "locator": { "by": "role", "value": "button", "name": "Continue" } }
{ "type": "fill", "locator": { "by": "label", "value": "Email" }, "value": "qa@example.test" }
{ "type": "assert_text", "locator": { "by": "text", "value": "Welcome" }, "expected": "Welcome" }
{ "type": "swipe", "direction": "up", "distance": 250 }
```

The native adapter deliberately rejects CSS/XPath and arbitrary script execution. WebView DOM automation is not silently inferred from a hybrid target: it needs an explicit context-aware action contract and is a later increment. The initial session manager accepts only `ios` and `android` execution targets; `hybrid` is rejected until the target model can specify the native platform and WebView/native context.

## Runtime setup

- Node.js 22.12 or newer.
- Android: JDK 11+, Android SDK, `ANDROID_HOME`, and `adb` on PATH; booted emulator or connected device.
- iOS: macOS 13+, Xcode and command line tools; booted simulator or connected device.
- Run `npx mobilewright doctor` before execution.

Start the service:

```bash
MOBILE_APP_BUNDLE_ID=com.example.app QA_EXECUTION_ADAPTER=mobilewright npm start
```

A run request must use `platform: "android"` or `platform: "ios"` and set `targetId` to the device UDID/serial accepted by Mobilewright. The current API does not install APK/IPA artifacts automatically; the application must already be installed on the selected device.

## Contract rules
1. `connect` must fail clearly when target capabilities are unsupported.
2. `getCurrentScreen` returns normalized semantic data; raw DOM/UI hierarchy is attached as evidence, not embedded without limits.
3. `executeAction` returns before/after snapshots when available and never silently converts a failed action into success.
4. Locator resolution order is supplied by the domain model. Adapter-specific fallback is recorded in result metadata.
5. Timeouts and retries are controlled by the execution engine, not hidden inside adapter methods, except for bounded low-level polling.
6. `captureEvidence` returns metadata and object-storage references; large binary payloads are not returned in API responses.
7. Adapter implementations may expose optional capability interfaces for network interception, WebView DOM inspection, deep links, permissions, biometrics and device logs.
8. A hybrid app may require coordinated WebView and native contexts. Context switches must be explicit in action/result metadata.
9. All timestamps are ISO 8601 UTC.
10. Do not persist vendor SDK objects. Normalize errors into stable `code`, `message`, and optional `details`.

## Ownership
- Execution Engine owns orchestration, timeout, retry, test data, run status and persistence.
- Adapter owns translating normalized actions/locators to Playwright or Mobilewright operations.
- Evidence Engine owns uploading bytes and persisting evidence metadata.
