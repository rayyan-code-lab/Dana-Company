# Auth.md — Who Can Do What

## 1. Login & Identity
User authentication in the Dana Company Foundry ERP is managed via **Supabase Auth** backed by JSON Web Tokens (JWT).

- **Authentication Method**: Email Address + Strong Password (`supabase.auth.signInWithPassword`).
- **Account Creation**: Public self-registration (sign-up) is **permanently disabled** on the client web interface. All user accounts must be provisioned directly by an authorized Administrator via the Supabase Dashboard or Administrative API.
- **Role Assignment**: User roles (`Admin_c` or `Manager_c`) are assigned in the user's metadata (`raw_user_meta_data.role`) or authoritative `public.user_roles` database mapping.
- **Session Tokens**: Access tokens (short-lived JWT) and refresh tokens are stored in the browser by the Supabase client. A lightweight user session cache is maintained in `localStorage` under `dana_foundry_user_session` to enable instantaneous page hydration on reload without route flickering.

---

## 2. Permission Table (Role-Based Access Control)

The ERP recognizes two distinct profiles:
- **`Admin_c` (Executive / Business Owner)**: Full administrative authority across operational, financial, and executive modules.
- **`Manager_c` (Shift Supervisor / Plant Floor Manager)**: Operational authority to record production, manage workers, mark daily attendance, log purchases, record sales, and disburse wage advances. Strictly restricted from viewing private owner funding, lender directories, company loans, modifying historical purchase records, or performing deletions.

| Table Name | Functional Domain | `Admin_c` Access | `Manager_c` Access | Server/DB Enforcement |
| :--- | :--- | :---: | :---: | :--- |
| `production_c` | Daily furnace runs & crucibles | **Full** (CRUD) | **Read, Create, Update** | RLS: Insert/Update allowed; Delete denied for Manager |
| `stock_items_c` | Raw material catalogue | **Full** (CRUD) | **Read, Create** | RLS: Update/Delete restricted to Admin |
| `stock_movements_c` | Inward/Outward stock ledger | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `purchases_c` | Scrap & raw material purchases | **Full** (CRUD) | **Read, Create, Update** (Restricted fields) | RLS: Delete restricted; sensitive audit fields read-only |
| `purchase_payments_c`| Supplier vouchers & payments | **Full** (CRUD) | **Read, Create** | RLS: Delete restricted to Admin |
| `purchase_audit_c` | Purchase price change log | **Full** (CRUD) | **Read, Create** | RLS: Append-only for Manager |
| `sales_c` | Castings & finished goods sales | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `expenses_c` | Daily factory operational expenses | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `workers_c` | Worker roster & master records | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `attendance_c` | Daily worker attendance daybook | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `payroll_c` | Monthly wage closing statements | **Full** (CRUD) | **Read Only** | RLS: Write denied for Manager |
| `worker_payments_c`| Wage settlements & worker advances | **Full** (CRUD) | **Read, Create** | RLS: Delete restricted to Admin |
| `transactions_c` | Cash/Bank general transaction ledger | **Full** (CRUD) | **Read, Create, Update** | RLS: Delete restricted to Admin |
| `lenders_c` | Private creditor & financier directory | **Full** (CRUD) | **None** (Denied) | RLS: SELECT, INSERT, UPDATE, DELETE denied |
| `borrowings_c` | Unsecured debts & loans taken | **Full** (CRUD) | **None** (Denied) | RLS: SELECT, INSERT, UPDATE, DELETE denied |
| `borrowing_repayments_c` | Loan repayment vouchers | **Full** (CRUD) | **None** (Denied) | RLS: SELECT, INSERT, UPDATE, DELETE denied |
| `owner_funding_c` | Capital injections by business owner | **Full** (CRUD) | **None** (Denied) | RLS: SELECT, INSERT, UPDATE, DELETE denied |
| `owner_funding_repayments_c` | Owner capital reimbursements | **Full** (CRUD) | **None** (Denied) | RLS: SELECT, INSERT, UPDATE, DELETE denied |

---

## 3. Account and Session Lifecycle

### Session Initialization & Bootstrapping
1. On initial page load, `DualModeSession` checks `localStorage` for `dana_foundry_user_session`.
2. Concurrently, `supabase.auth.getSession()` validates the JWT against Supabase.
3. If valid, the user identity and role are confirmed and synchronized.
4. If expired or invalid, the session state is purged and the user is redirected to `/login`.

### Route Protection
- Route metadata in `src/router/index.jsx` enforces `access: 'authenticated'`.
- [RootLayout.jsx](file:///Users/rayyanmushahid/Downloads/iris-foundry-company-dee844b180086760f75190475f9f62d313ed1f11/src/layouts/RootLayout.jsx) intercepts all unauthenticated requests and redirects them to `/login?redirect=<target>`.
- Client-side menu navigation dynamically hides restricted links (e.g. Finance Borrowings, Owner Funding, User Admin) for `Manager_c`.

### Sign Out & Revocation
- Clicking **Sign Out** triggers `DualModeSession.logout()`, which:
  1. Issues `supabase.auth.signOut()` to revoke server-side refresh tokens.
  2. Purges the cached session `dana_foundry_user_session` from `localStorage`.
  3. Dispatches `clearUser()` to reset Redux store state.
  4. Redirects to `/login`.

---

## 4. Two-Account Test Plan

| Test ID | Persona A (`Admin_c`) | Persona B (`Manager_c`) | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- | :--- |
| **AUT-01** | Logs into `/borrowings` | Attempts to access `/borrowings` | Admin granted access; Manager blocked by UI and DB returns 403 / empty | Browser navigation & direct REST API call |
| **AUT-02** | Deletes an errant payment record | Attempts to delete a payment record | Admin delete button works; Manager sees no delete button; API returns error on manual DELETE | UI check & PostgREST DELETE request |
| **AUT-03** | Records a worker advance | Records a worker advance | Both roles permitted to disburse advances; both succeed | UI form submission in Payroll |
| **AUT-04** | Revokes Manager account in Supabase | Manager attempts to refresh page | Active session invalidated upon token refresh; kicked to `/login` | Supabase auth user status toggle |

---

## 5. Open Questions
1. **Password Policy**: What is the minimum password complexity requirement (length, symbols, numbers) enforced by the Supabase project auth settings?
2. **Session Lifespan**: What is the JWT expiration duration configured in the Supabase project dashboard (recommended: 3600 seconds / 1 hour)?
