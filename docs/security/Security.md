# Security.md — The Rules Every Feature Follows

## 1. Scope
This document sets the baseline security standards and operational rulebook for the **Dana Company Foundry ERP** application. It applies to all frontend modules (React/Vite), backend integration services (Supabase PostgreSQL, PostgREST API, Supabase Auth), and local offline simulation engines.

Every new module, workflow, and API interaction must comply with the rules established below.

---

## 2. Security Rules

### Rule 1: Zero Trust on Input Data & Robust Server-Side Validation
- **Requirement**: Never trust data originating from client input fields, URL query parameters, or local storage. All numerical quantities (weights in kg, currency in INR, shift units) must be validated for finiteness, non-negativity, and reasonable bounds before committing to state or database tables.
- **Where Enforced**: 
  - Workflow services: `src/services/purchaseWorkflow.js`, `src/services/productionWorkflow.js`, `src/services/borrowingWorkflow.js`, and `src/components/WageManagement.jsx`.
  - Database level: PostgreSQL column constraints (`NUMERIC(14,2)`, `CHECK` constraints on non-negative amounts, foreign key lookup sanity).
- **How to Test**:
  - Submit negative values for purchase weights (`-100 kg`), negative wages, or empty worker IDs.
  - Verify that the workflow throws a clean validation error and refuses to submit transactions to the database.

### Rule 2: Safe Database Querying & Elimination of Dynamic Evaluation
- **Requirement**: Never assemble raw SQL statements via string concatenation. Database interactions must utilize parameterized query builders provided by `@supabase/supabase-js` or PostgREST operators (`eq`, `lte`, `gte`, `ilike`). Dynamic code evaluation primitives (such as `eval()` or `new Function()`) are prohibited in route and rule validation logic.
- **Where Enforced**:
  - `src/services/supabaseEngine.js` (abstracts all database queries through Supabase table builder).
  - `src/router/route.utils.js` (safe role parsing without dynamic code execution).
- **How to Test**:
  - Inspect network tab during data filtering (e.g. search box or period controls) to verify queries use strict query string parameters rather than arbitrary SQL fragments.

### Rule 3: Strict Secret Isolation & Key Management
- **Requirement**: No private credentials, database connection strings, secret service-role API keys, or JWT signing secrets may ever be bundled into frontend client code or pushed to Git repositories.
- **Where Enforced**:
  - `.env` and `.gitignore`: Only public, non-secret parameters (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are exposed to the browser.
  - The repository `.gitignore` explicitly excludes `.env`, `*.local`, `dist/`, and build artifacts.
- **How to Test**:
  - Run `git ls-files .env` to verify `.env` is uncommitted.
  - Audit bundled production assets in `dist/assets/*.js` for accidental leakage of private keys or service tokens.

### Rule 4: File Upload & Attachment Restrictions
- **Requirement**: Uploaded documents (e.g. weighbridge vouchers, purchase receipts, supplier invoices) must be restricted to allowed MIME types (`image/jpeg`, `image/png`, `application/pdf`) and capped at a maximum of 10 MB per file. File names must be sanitized before persisting to cloud storage buckets.
- **Where Enforced**:
  - File upload handlers and Supabase Storage bucket policies (`storage.objects`).
- **How to Test**:
  - Attempt to upload an executable (`.exe`, `.sh`) or oversized payload (> 10 MB) to purchase attachment inputs and verify the request is rejected.

### Rule 5: Error Handling & Data Leak Prevention
- **Requirement**: Never expose raw database stack traces, SQL error codes, internal server paths, or PostgreSQL schema dumps in user-facing toasts or UI notifications.
- **Where Enforced**:
  - `src/services/supabaseEngine.js`: Error catch blocks sanitize error objects before propagating user-friendly error messages.
  - `ErrorBoundary.jsx` and `RootLayout.jsx`: Top-level crash guards catch uncaught exceptions and render a clean fallback UI.
- **How to Test**:
  - Trigger a simulated database disconnection or invalid table query and verify the user receives a graceful alert ("Could not load records") rather than a raw database traceback.

### Rule 6: Guarding Destructive and Costly Operations
- **Requirement**: Destructive actions (e.g., deleting payments, wiping records, resetting factory demo data) require explicit confirmation dialogs and administrative authorization. Operations that initiate financial disbursements or material consumptions must incorporate idempotency keys to prevent double-spending or duplicate charges on double-click.
- **Where Enforced**:
  - `WageManagement.jsx` (double confirmation on payment removal).
  - `productionWorkflow.js` (`idempotencyKey_c` check preventing duplicate stock-out entries).
  - `purchaseWorkflow.js` (`idempotencyKey_c` check on invoice creation).
- **How to Test**:
  - Double-click a production batch submission button rapidly; verify only one record and one inventory deduction is written to the ledger.

---

## 3. Open Questions & Future Enhancements
1. **Multi-Factor Authentication (MFA)**: Should SMS or TOTP authenticator MFA be enforced for users holding the `Admin_c` profile?
2. **Audit Logging Table**: Should every edit or delete operation write to a dedicated, append-only `system_audit_log_c` table in Supabase?
3. **Session Timeout Policies**: Should inactive browser sessions automatically invalidate after 15 minutes of idle time?
