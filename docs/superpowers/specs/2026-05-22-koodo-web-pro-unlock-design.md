# Koodo Reader Self-Hosted Web Pro Unlock Design

## Goal

For the current self-hosted Web deployment only, remove Pro/trial enforcement so all Pro-gated capabilities are usable during local testing, while keeping existing Pro, upgrade, and paid wording in the UI unchanged.

## Scope

This design applies only to the self-hosted Web build currently deployed by us. It does not change Electron behavior, Android behavior, official cloud behavior, payment flows, or branding copy. It also does not attempt to hide Pro labels or upgrade-related UI.

## Non-Goals

- Reworking the Koodo Reader licensing model
- Removing Pro wording from the interface
- Replacing or mocking the official backend globally
- Unlocking all environments built from this repository
- Cleaning up unrelated Electron or Android work

## Current Problem

The current Web deployment is accessible and usable, but Pro restrictions are still enforced across multiple UI and state paths. The enforcement is not centralized in one obvious file:

1. Some flows react to account or trial state and redirect users back to home or login.
2. Some dialogs explicitly show expired-trial or redeem/renew flows.
3. Some feature entry points depend on authenticated or upgraded state before allowing access.

Because the user only needs a self-hosted test build for personal use, the fastest safe path is not to remove all Pro UI. The fastest safe path is to add a narrow self-hosted Web unlock mode and route existing enforcement checks through it.

## Proposed Approach

Introduce a single self-hosted Web unlock helper that answers one question: should the current runtime behave as fully unlocked for Pro enforcement purposes?

That helper will be used only in the current self-hosted Web environment. When it returns true:

- trial-expired enforcement is bypassed
- Pro feature guards treat the user as eligible
- login or support prompts that exist only to restore Pro access do not block usage

When it returns false, existing behavior remains unchanged.

## Activation Strategy

The unlock mode should be activated only for the current self-hosted Web deployment.

Preferred activation order:

1. An explicit Web runtime flag that we control in the deployed build
2. A narrow deployment check for the current self-hosted host/origin as a fallback

The implementation should avoid enabling unlock mode merely because the app is running in a browser. Official hosted Web or future public deployments must continue to use normal licensing behavior unless explicitly opted in.

## Architecture

### 1. Central unlock helper

Add one focused helper module for self-hosted Pro unlock detection. Its responsibilities:

- determine whether the current runtime is the approved self-hosted Web environment
- expose a boolean such as `isSelfHostedWebProUnlocked()`
- expose any small companion helpers needed by UI or request code

This keeps environment detection and unlock policy in one place instead of repeating host checks or config checks throughout the app.

### 2. UI enforcement integration

Update UI nodes that currently block usage because Pro has expired or the user is not upgraded.

Expected affected areas include:

- support or expired-trial dialog flows
- login page behavior that forces the user back after a Pro-expired path
- header or settings flows that gate premium actions

These changes should preserve the visible wording and layout, but skip the blocking behavior when unlock mode is active.

### 3. State and request integration

Where Pro access is inferred from fetched user state, auth state, or config flags, add a thin override so that self-hosted Web unlock mode is treated as eligible even if the upstream account state is trial-expired or unauthenticated.

This should be done at a thin boundary, not by scattering hardcoded `true` values across pages. The goal is to keep a single explanation for why the self-hosted build behaves differently.

## Expected File Areas

Likely files to touch:

- `src/utils/` for the new self-hosted unlock helper
- `src/components/dialogs/supportDialog/component.tsx`
- `src/pages/login/component.tsx`
- `src/containers/header/component.tsx`
- additional files that currently interpret auth or upgraded state as a hard blocker

The final implementation may touch fewer or slightly different files once all guard paths are confirmed, but the change should stay centered around the helper plus a small number of integration points.

## Behavior After Change

In the current self-hosted Web deployment:

- the app remains visibly branded the same way
- Pro and upgrade wording may still appear
- the user is not blocked from using Pro-gated capabilities because of trial or renewal checks
- feature access is determined by self-hosted unlock mode rather than official entitlement state

Outside that deployment:

- existing behavior remains unchanged

## Risks

### Risk: unlock logic leaks into public Web builds

Mitigation: require an explicit self-hosted activation signal and keep the detection isolated in one helper.

### Risk: a hidden guard path still blocks a feature

Mitigation: integrate the helper at the main enforcement boundaries rather than changing one screen at a time, then validate common entry paths manually in the deployed Web build.

### Risk: auth-dependent features still fail after UI unlock

Mitigation: separate enforcement bypass from actual remote API requirements. If a feature truly requires a backend token for cloud sync or account APIs, the UI may become accessible but the request should still fail transparently instead of pretending the backend succeeded.

## Error Handling

Unlock mode only bypasses local entitlement enforcement. It must not silently fake successful network operations.

If a Pro-labeled feature still depends on a real remote API and that API fails because there is no valid account or server support, the app should surface the existing request error rather than inventing a success path.

## Testing Strategy

### Build verification

- production Web build still completes successfully

### Behavior verification in self-hosted deployment

- app loads normally in the current hk2 Web deployment
- expired-trial or renew flows no longer block navigation
- at least one representative Pro-gated entry path can be opened directly
- existing non-Pro flows continue to work

### Regression guard

- normal behavior remains unchanged when unlock mode is not active

## Rollback Plan

Because the design centralizes the unlock decision in one helper, rollback is straightforward:

1. disable the self-hosted activation signal, or
2. revert the helper integration commit(s)

This returns the app to the original licensing enforcement behavior without needing to unwind broad UI edits.

## Recommended Implementation Sequence

1. Add the self-hosted Web unlock helper
2. Integrate it into the expired-trial and support-dialog flow
3. Integrate it into login and upgraded-state guards
4. Validate representative Pro entry points in the deployed Web build
5. Redeploy the updated Web build to hk2
