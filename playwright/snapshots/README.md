# Visual Regression Baselines

This directory contains PNG baseline screenshots committed to source control.
Playwright compares new screenshots against these baselines on every CI run.

## Updating Baselines

When a UI change is intentional, regenerate and commit the baselines:

```bash
npx playwright test --project=visual-regression --update-snapshots
git add playwright/snapshots
git commit -m "chore: update visual regression baselines"
```

## Threshold

Tests fail if the pixel diff exceeds **0.5 %** of total pixels
(`maxDiffPixelRatio: 0.005`).

## Viewports

| Name    | Width | Height |
|---------|-------|--------|
| desktop | 1280  | 800    |
| mobile  | 375   | 812    |

## Themes

Each page is captured in both `light` and `dark` mode (20 baselines total:
5 pages × 2 themes × 2 viewports).

## Pages

| Label                | Route        | Notes                                   |
|----------------------|--------------|-----------------------------------------|
| landing              | `/`          | Default landing page                    |
| dashboard-connected  | `/dashboard` | Wallet stub active                      |
| deposit-modal        | `/`          | Opens deposit modal if trigger present  |
| transaction-history  | `/dashboard` | Opens history panel if trigger present  |
| settings             | `/settings`  | Full settings page                      |
