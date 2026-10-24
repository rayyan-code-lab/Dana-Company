# Threat Model.md — Finding the Most Likely Weak Spots

## 1. System Overview & Entry Points

The **Dana Company Foundry ERP** operates across three functional layers:
1. **Client Browser Tier**: React single-page app bundled with Vite. Executes workflow logic, form validation, route navigation, and role-based UI adaptations.
2. **Integration Engine Tier**: Dual-mode data client (`supabaseEngine.js`) communicating with Supabase PostgreSQL over REST/PostgREST.
3. **Database & Storage Tier**: Supabase PostgreSQL hosting 18 operational/financial tables, PostgreSQL canonical SQL views, and authentication services.

### Assets at Risk
- Proprietary foundry casting recipes and crucible batch records.
- Executive borrowing agreements, private lender contacts, and owner capital reimbursement records.
- Raw scrap metal inventory balances and physical stock count accuracy.
- Commercial sales ledger, profit & loss metrics, and customer pricing data.
- Worker personal telephone numbers, wage rates, and cash disbursement records.

---

## 2. Realistic Abuse Scenarios

### Scenario 1: Unauthenticated Public Querying via Open RLS
- **Actor**: Any external internet user or automated web scraper.
- **What Must Be True**: The user obtains the public project URL and publishable `anon` key from frontend JavaScript network requests. The database schema has an open RLS policy (`CREATE POLICY "Public access policy" ON ... TO anon USING (true)`).
- **The Harm**: Complete exfiltration of all company financial records, borrowings, supplier purchases, and employee rosters without authentication.
- **Proposed Protection**: Revoke all public/anon RLS access on private tables via migration `003_secure_rls_policies.sql`. Require `TO authenticated` and restrict sensitive tables to `Admin_c`.
- **Test**: Send an unauthenticated HTTP `GET /rest/v1/borrowings_c` using the anon key. The database must return `401 Unauthorized` or empty array `[]`.

### Scenario 2: Manager Privilege Escalation into Executive Debt & Lenders
- **Actor**: A valid authenticated user with the `Manager_c` role.
- **What Must Be True**: The Manager opens browser DevTools or uses an API client (e.g. Postman) with their valid JWT to call `/rest/v1/lenders_c` or `/rest/v1/borrowings_c`, bypassing the hidden UI buttons.
- **The Harm**: A shift supervisor reads private executive loan balances, lender phone numbers, or owner capital injections.
- **Proposed Protection**: Database-level Row-Level Security policy evaluating `auth.jwt() -> 'user_metadata' ->> 'role'` and denying SELECT/INSERT/UPDATE/DELETE on `lenders_c` and `borrowings_c` for non-admins. Also add client-side SDK enforcement in `DualModeTable`.
- **Test**: Submit a query for `lenders_c` using a Manager's authentication token. The database must reject the query with access denied.

### Scenario 3: Accidental or Malicious Deletion of Production & Worker Records
- **Actor**: A Manager attempting to delete a failed crucible melt or worker record to cover an operational discrepancy.
- **What Must Be True**: Deletion endpoints allow requests without checking if the caller has `canDelete` permissions.
- **The Harm**: Irreversible loss of historical manufacturing data, corrupting physical inventory reconciliation and raw scrap cost calculations.
- **Proposed Protection**: Disable DELETE policies in Supabase RLS for `Manager_c`. Enforce `getTableAccess().canDelete` in `supabaseEngine.js` before executing `remove()`.
- **Test**: Attempt to issue `sdk.table('workers_c').remove('wrk-001')` from a Manager session. The SDK and DB must reject the deletion with an authorization error.

### Scenario 4: Negative Stock Drift via Unchecked Production Submissions
- **Actor**: An operator recording a batch with higher raw material consumption than physically available in the stock yard.
- **What Must Be True**: The production service fails to verify available inventory balance before writing stock-out movement entries.
- **The Harm**: Negative inventory numbers in stock ledgers, erroneous raw material valuation, and corrupt material yield metrics.
- **Proposed Protection**: Pre-flight stock availability verification in `productionWorkflow.js` with stock tolerance checks and automated transaction rollbacks.
- **Test**: Submit a production run consuming 5,000 kg of Brass Scrap when only 1,000 kg exists. The workflow must abort with a descriptive error.

### Scenario 5: Double Disbursement of Cash Advances on Rapid Double-Click
- **Actor**: A manager recording a cash advance for a worker who double-clicks "Save transaction".
- **What Must Be True**: The payment submission handler lacks button disablement, single-flight locking, or idempotency keys.
- **The Harm**: Two advance entries created for the worker, falsely doubling their deduction and distorting cash balances.
- **Proposed Protection**: Synchronous `savingPayment` state lock in `WageManagement.jsx` + unique payment reference generation.
- **Test**: Rapidly trigger `savePayment()` twice concurrently; verify only one record is written.

---

## 3. Threat Assessment Table

| Risk | Why It Matters | Protection | Test | Owner | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Open Anon RLS on All Tables** | Unauthenticated visitors can read and wipe company data using anon key | Migration `003_secure_rls_policies.sql` restricting tables to `authenticated` | `GET /rest/v1/workers_c` with anon key returns no unauthorized rows | Lead Dev / DBA | **Remediation Script Prepared** |
| **Manager Access to Debt & Lenders** | Confidentiality breach regarding company debt and private lenders | Restrict `lenders_c`, `borrowings_c`, `owner_funding_c` to `Admin_c` in RLS & SDK | Manager token queries `borrowings_c` and receives permission denial | Security Lead | **Remediation Script Prepared** |
| **Unauthorized Record Deletion** | Loss of historical casting and ledger integrity | Deny DELETE on all tables for `Manager_c` in RLS & SDK | Manager attempts `DELETE /rest/v1/sales_c` and is rejected | App Developer | **Remediation Script Prepared** |
| **Tampering with Session Cache in LocalStorage** | User alters `dana_foundry_user_session` in DevTools to simulate Admin | Supabase token validation runs in background on every boot and overrides local role | Change local cache role to `Admin_c`, observe `getSession()` refreshes to true role | Frontend Dev | **Active in Code** |
| **Eval Injection in Route Access** | Dynamic code execution vulnerability in `route.utils.js` | Replace `new Function` with safe static role comparison | Unit test with malicious rule string; verify no arbitrary code execution | Frontend Dev | **Remediation Applied** |

---

## 4. Weaknesses Found in Code vs Theoretical Risks

1. **Weakness Found in Code (HIGH SEVERITY)**:
   In `supabase/migrations/001_initial_schema.sql` line 382:
   ```sql
   CREATE POLICY "Public access policy" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
   ```
   This policy was created during initial bootstrapping and granted full CRUD privileges to `anon`. This must be updated in production Supabase projects via `003_secure_rls_policies.sql`.

2. **Weakness Found in Code (MEDIUM SEVERITY)**:
   In `src/router/route.utils.js` line 15:
   ```javascript
   const fn = new Function('profile', `return (${rule});`);
   ```
   Using `new Function` to parse route permissions creates unnecessary execution risk. It should be refactored to use explicit conditional checks.

3. **Theoretical Risk (LOW SEVERITY)**:
   Client-side secret leakage. Codebase inspection confirmed that no private service keys or database passwords exist in frontend source code.
