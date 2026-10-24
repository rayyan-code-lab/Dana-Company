# Data Security.md — What You Store and How You Protect It

## 1. Data Inventory

The Dana Company Foundry ERP stores manufacturing, operational, and financial records necessary for commercial casting production, supply-chain accounting, and statutory wage disbursement.

| Data Classification | Specific Data Fields | Storage Location | Business Purpose | Access Policy | Retention Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Profile Data** | User Email, Password Hash, Assigned Role (`Admin_c` / `Manager_c`), Display Name | Supabase Auth (`auth.users`), `localStorage` session cache | User identification and role-based authorization | Authenticated user reads own profile; Admin manages | Retained for employee tenure; purged upon termination |
| **Worker & Personnel Data** | Worker Name, Phone Number, Daily Wage Rate, Monthly Salary, Worker Type, Attendance History | `public.workers_c`, `public.attendance_c` | Factory labor scheduling, statutory wage calculation | All authenticated staff can view; Admin/Manager update | Permanent historical ledger for compliance audit |
| **Wage & Payroll Disbursements** | Worker Advances, Payment Dates, Payment Method (Cash, UPI, Bank), Notes, Net Wages | `public.worker_payments_c`, `public.payroll_c` | Tracking cash outflows, wage advances, and worker balance | Manager can create advances; Admin has full control | 7 years minimum for tax and commercial dispute audit |
| **Raw Material & Inventory** | Scrap Grade, Inward/Outward Weight (kg), Unit Price, Supplier Name, Stock Balance | `public.stock_items_c`, `public.stock_movements_c` | Tracking scrap inventory, furnace charging, scrap yield | Admin & Manager view and log stock movements | Retained indefinitely for yield and production analytics |
| **Production & Crucible Logs** | Heat Number, Date, Product Name, Raw Material Consumed (kg), Finished Castings (kg) | `public.production_c` | Furnace efficiency analysis, crucible run accounting | Admin & Manager create and view | Retained indefinitely |
| **Commercial Purchases & Sales** | Invoices, Customer Name, Sale Price, Payment Status, Purchase Receipts | `public.purchases_c`, `public.sales_c`, `public.purchase_payments_c` | Sales revenue tracking, vendor accounts payable | Admin full; Manager operational create/read | 7 years minimum for financial auditing |
| **Executive Finance & Debt** | Private Lender Names, Loan Amounts, Interest Terms, Owner Capital Reimbursements | `public.lenders_c`, `public.borrowings_c`, `public.owner_funding_c` | Executive liquidity management & capital structure | **Strictly Admin_c only**. Hidden from Managers | 7 years minimum |
| **Receipt & Voucher Attachments** | Scanned weighbridge slips, supplier invoices, payment proofs (PDF, PNG, JPG) | Supabase Storage (`foundry-attachments` bucket) | Commercial proof of purchase and material delivery | Authenticated staff associated with the transaction | Retained with the corresponding transaction |

---

## 2. Protection Rules

### In-Transit Security (Encryption in Transit)
- All communications between the browser client and Supabase services (PostgREST API, Auth endpoints, Realtime WebSocket) are encrypted using **TLS 1.3 / HTTPS**.
- Direct unencrypted HTTP access is blocked; browsers automatically upgrade requests to HTTPS.

### At-Rest Security (Encryption at Rest)
- Supabase PostgreSQL databases are hosted on AWS/GCP infrastructure with hardware-accelerated **AES-256 block-level disk encryption**.
- Supabase Storage files and database backups are encrypted at rest using platform-managed AES-256 encryption.

### Secret Management & Browser Isolation
- No database master passwords, service-role private keys, or backend secrets are packaged into the frontend client.
- The browser only holds the public publishable anon key (`VITE_SUPABASE_ANON_KEY`), whose data access is strictly governed by Row-Level Security (RLS) policies.

### Log Hygiene & Credential Scrubbing
- Application error logging (`console.error`, error boundary capture) must never output user passwords, authentication bearer tokens, or full database connection strings.
- Passwords entered in `AuthPage.jsx` are transmitted directly over HTTPS to the auth endpoint and immediately discarded from memory upon completion of authentication.

---

## 3. Deletion and Backups

### Active Storage Deletion
- When an administrator deletes a record (e.g., an errant payment via `WageManagement.jsx`), the record is removed immediately from the active PostgreSQL table via `DELETE FROM public.worker_payments_c WHERE "Id" = $1`.
- If a production run is deleted, `productionWorkflow.js` automatically creates an offsetting stock-in reversal (`PRODUCTION-REVERSAL:<id>`) so physical inventory counts remain strictly balanced.

### Backup Strategy & Disaster Recovery
- **Snapshot Frequency**: Daily automated PostgreSQL WAL (Write-Ahead Logging) backups managed by the Supabase platform.
- **Point-in-Time Recovery (PITR)**: Enables rolling back database state to any specific minute in the event of catastrophic data corruption or human error.
- **Backup Retention**: Automated daily snapshots are maintained for 7 to 30 days depending on the Supabase project tier.

---

## 4. Open Questions
1. **Attachment Bucket Privacy**: Are the Supabase storage buckets set to `private` with signed URL access, or `public`? (Must be verified in Supabase Dashboard).
2. **Data Export & Archival**: Does the company require an automated weekly CSV/SQL cold-storage export to off-site cloud storage?
