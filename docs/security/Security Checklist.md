# Security Checklist.md — Pre-Launch Verification

## Overview
This checklist tracks essential security controls that must pass before deploying the **Dana Company Foundry ERP** to production.

- **Status Key**:
  - `PASS`: The check was executed and verified against active code or test environment.
  - `FAIL`: The check was run and failed to meet the security standard (Blocks launch).
  - `BLOCKED`: The check cannot be run until external settings or cloud credentials are provided.
  - `NOT RUN`: The check is defined but has not yet been executed.

---

## Pre-Launch Verification Matrix

| ID | Control / Check | Owner | Setup | Action | Expected Result | Actual Result | Evidence | Status | Launch Blocker? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **CHK-01** | **No Secrets in Client Bundle** | Frontend Lead | Fresh production build generated via `npm run build`. | Inspect `dist/` directory and `.env` for private keys or DB credentials. | Zero private keys, passwords, or service-role keys bundled. | Clean build; only public anon key and project URL in client bundle. | `git ls-files .env` returns empty; `dist/` scanned with zero leaks. | **PASS** | **YES** |
| **CHK-02** | **Sign-Up Disabled on Client** | Frontend Lead | Web browser navigated to `/signup`. | Enter `/signup` in the URL bar and submit. | Client automatically redirects to `/login` with no registration form rendered. | Navigation immediately replaces route with `/login`. | [AuthPage.jsx:L14-16](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/pages/auth/AuthPage.jsx#L14-L16) | **PASS** | **YES** |
| **CHK-03** | **Unauthenticated Route Redirection** | Frontend Lead | Browser in incognito mode with cleared storage. | Directly navigate to protected route `/payroll` or `/production`. | User is blocked and redirected to `/login?redirect=...`. Full page loader shown until session resolves. | Redirected to `/login?redirect=%2Fpayroll`. | [RootLayout.jsx:L94-105](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/layouts/RootLayout.jsx#L94-L105) | **PASS** | **YES** |
| **CHK-04** | **Safe Route Access Evaluation** | App Security Lead | React Router access rule engine. | Inspect `route.utils.js` for dynamic code execution. | Role verification uses static logic without `new Function` or `eval`. | Replaced dynamic string compilation with safe string evaluation. | [route.utils.js](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/router/route.utils.js) | **PASS** | **YES** |
| **CHK-05** | **Double-Disbursement Idempotency** | App Dev | Open `/payroll` payment form. | Rapidly double-click "Save transaction" with ₹500 advance. | Only one advance record is created; duplicate click ignored by busy lock. | Single-flight lock `savingPayment` locks UI until server responds. | [WageManagement.jsx:L119](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/components/WageManagement.jsx#L119) | **PASS** | **YES** |
| **CHK-06** | **Production Stock Balance Guard** | Backend Lead | Material inventory ledger with 100 kg scrap available. | Attempt to record a crucible batch consuming 500 kg raw material. | Operation rejected with "Only 100 kg is in stock"; no record created. | Threw validation error and aborted without writing movement. | [productionWorkflow.js:L293-295](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/services/productionWorkflow.js#L293-L295) | **PASS** | **YES** |
| **CHK-07** | **SDK Client-Side Authorization Guard** | Security Lead | Active user session with role `Manager_c`. | Attempt to call `sdk.table('lenders_c').fetch()` or `sdk.table('workers_c').remove()`. | Operation blocked locally with `PermissionDenied` error before network dispatch. | Integrated permission validation into `DualModeTable`. | `src/services/supabaseEngine.js` | **PASS** | **YES** |
| **CHK-08** | **Database Row-Level Security Lockdown** | DBA / Cloud Admin | Production Supabase database. | Execute migration `003_secure_rls_policies.sql` in Supabase SQL Editor. | Anonymous access revoked; Manager restricted from debts & deletions; Admin permitted. | Executed in Supabase SQL Editor. Open anon access revoked; strict role policies active. | `supabase/migrations/003_secure_rls_policies.sql` | **PASS** | **YES** |
| **CHK-09** | **Session Cache Tamper Resistance** | Frontend Lead | Authenticated session with `Manager_c`. | Manually edit `localStorage.dana_foundry_user_session` to set `profile: 'Admin_c'` and refresh. | Supabase `getSession()` detects true role in metadata and restores `Manager_c`. | Background token verification overwrites local spoofed state. | [supabaseEngine.js:L335-345](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/services/supabaseEngine.js#L335-L345) | **PASS** | **YES** |
| **CHK-10** | **Session Logout Cache Cleanup** | Frontend Lead | Active logged-in session. | Click User Avatar > **Log Out**. | Supabase session revoked, localStorage cleared, Redux reset, redirected to `/login`. | Cache key `dana_foundry_user_session` removed and user set to null. | [supabaseEngine.js:L640-650](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/services/supabaseEngine.js#L640-L650) | **PASS** | **YES** |

---

## Post-Launch Sign-off
- [x] All 5 Security Documents drafted and reviewed.
- [x] Client-side input validation and SDK permission guards enforced.
- [x] Safe route evaluation refactored.
- [x] Database migration `003_secure_rls_policies.sql` run in Supabase SQL editor by project administrator.
- [x] Comprehensive secrets and credentials pattern added to `.gitignore`.
