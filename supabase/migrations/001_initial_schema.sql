-- =============================================================================
-- DANA COMPANY OPERATIONS & FOUNDRY ERP — SCHEMA MIGRATION v1.0
-- Authoritative PostgreSQL 15+ Schema for 18 Custom Tables + RLS + Initial Seed
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. WORKERS DIRECTORY (`workers_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workers_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('wrk-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT NOT NULL,
    "role_c" TEXT,
    "workerType_c" TEXT DEFAULT 'Regular',
    "payType_c" TEXT DEFAULT 'daily',
    "phone_c" TEXT,
    "dailyRate_c" NUMERIC(14,2) DEFAULT 0,
    "monthlySalary_c" NUMERIC(14,2) DEFAULT 0,
    "status_c" TEXT DEFAULT 'Active',
    "isArchived_c" BOOLEAN DEFAULT false,
    "joinedOn_c" DATE,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. RAW MATERIAL CATALOG (`stock_items_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_items_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('stk-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT NOT NULL,
    "itemCode_c" TEXT UNIQUE,
    "unit_c" TEXT DEFAULT 'kg',
    "status_c" TEXT DEFAULT 'Active',
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. STOCK MOVEMENTS REGISTER (`stock_movements_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('mov-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "movementType_c" TEXT NOT NULL,
    "weightKg_c" NUMERIC(14,3) NOT NULL,
    "unitPrice_c" NUMERIC(14,2) DEFAULT 0,
    "totalValue_c" NUMERIC(14,2) DEFAULT 0,
    "movementDate_c" DATE NOT NULL,
    "stockItem_c" JSONB,
    "purchase_c" TEXT,
    "purchaseId_c" TEXT,
    "movementKey_c" TEXT,
    "supplierOrReason_c" TEXT,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. PURCHASES & PROCUREMENT (`purchases_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('pur-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "purchaseRef_c" TEXT NOT NULL UNIQUE,
    "stockItem_c" JSONB,
    "quantityKg_c" NUMERIC(14,3) NOT NULL,
    "pricePerKg_c" NUMERIC(14,2) NOT NULL,
    "totalPurchaseValue_c" NUMERIC(14,2) NOT NULL,
    "purchaseDate_c" DATE NOT NULL,
    "supplierName_c" TEXT,
    "supplierContact_c" TEXT,
    "advanceAmount_c" NUMERIC(14,2) DEFAULT 0,
    "advanceDate_c" DATE,
    "advanceMethod_c" TEXT,
    "cashAtPurchase_c" NUMERIC(14,2) DEFAULT 0,
    "onlineAtPurchase_c" NUMERIC(14,2) DEFAULT 0,
    "totalPaid_c" NUMERIC(14,2) DEFAULT 0,
    "outstandingBalance_c" NUMERIC(14,2) DEFAULT 0,
    "paymentStatus_c" TEXT DEFAULT 'Unpaid',
    "recordStatus_c" TEXT DEFAULT 'Active',
    "revision_c" INTEGER DEFAULT 1,
    "idempotencyKey_c" TEXT,
    "cancellationReason_c" TEXT,
    "cancelledAt_c" TIMESTAMPTZ,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. PURCHASE INSTALLMENT PAYMENTS (`purchase_payments_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_payments_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('pay-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "paymentRef_c" TEXT NOT NULL UNIQUE,
    "purchase_c" TEXT NOT NULL,
    "paymentType_c" TEXT,
    "paymentMethod_c" TEXT NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "paymentDate_c" DATE NOT NULL,
    "reference_c" TEXT,
    "fundingBreakdown_c" TEXT,
    "directBorrowing_c" TEXT,
    "idempotencyKey_c" TEXT,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. PURCHASE AUDIT TRAIL (`purchase_audit_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_audit_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('aud-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "auditKey_c" TEXT UNIQUE,
    "purchase_c" TEXT,
    "action_c" TEXT,
    "summary_c" TEXT,
    "eventAt_c" TIMESTAMPTZ DEFAULT NOW(),
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 7. PRODUCTION RUNS (`production_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('prod-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "productionDate_c" DATE NOT NULL,
    "productName_c" TEXT NOT NULL,
    "rawMaterialKg_c" NUMERIC(14,3) NOT NULL,
    "producedKg_c" NUMERIC(14,3) NOT NULL,
    "idempotencyKey_c" TEXT,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. COMMERCIAL SALES (`sales_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('sal-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "saleId_c" TEXT NOT NULL UNIQUE,
    "saleDate_c" DATE NOT NULL,
    "customerName_c" TEXT,
    "customerContact_c" TEXT,
    "productName_c" TEXT NOT NULL,
    "weightKg_c" NUMERIC(14,3) NOT NULL,
    "unitPrice_c" NUMERIC(14,2) NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "paymentMethod_c" TEXT,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. BUSINESS OPERATING EXPENSES (`expenses_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('exp-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT NOT NULL,
    "expenseDate_c" DATE NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "paymentMethod_c" TEXT NOT NULL,
    "attachments_c" JSONB DEFAULT '[]'::jsonb,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. ATTENDANCE DAYBOOK (`attendance_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('att-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "worker_c" JSONB,
    "attendanceDate_c" DATE NOT NULL,
    "status_c" TEXT NOT NULL,
    "hoursWorked_c" NUMERIC(5,2) DEFAULT 8.0,
    "overtimeHours_c" NUMERIC(5,2) DEFAULT 0,
    "wagePerDay_c" NUMERIC(14,2) NOT NULL,
    "attendanceUnits_c" NUMERIC(4,2) NOT NULL,
    "earnedWage_c" NUMERIC(14,2) NOT NULL,
    "workerTypeSnapshot_c" TEXT,
    "attendanceKey_c" TEXT UNIQUE,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 11. PAYROLL STATEMENTS (`payroll_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('payr-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "worker_c" JSONB,
    "payPeriod_c" TEXT NOT NULL,
    "daysPresent_c" NUMERIC(5,2) DEFAULT 0,
    "grossPay_c" NUMERIC(14,2) DEFAULT 0,
    "advance_c" NUMERIC(14,2) DEFAULT 0,
    "deductions_c" NUMERIC(14,2) DEFAULT 0,
    "netPay_c" NUMERIC(14,2) DEFAULT 0,
    "status_c" TEXT DEFAULT 'Draft',
    "paidOn_c" DATE,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 12. WORKER ADVANCES & SETTLEMENTS (`worker_payments_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_payments_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('wpay-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "worker_c" JSONB,
    "paymentDate_c" DATE NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "transactionType_c" TEXT NOT NULL,
    "paymentMethod_c" TEXT NOT NULL,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 13. LENDERS DIRECTORY (`lenders_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lenders_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('len-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT NOT NULL,
    "phone_c" TEXT,
    "relationship_c" TEXT,
    "status_c" TEXT DEFAULT 'Active',
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 14. PERSONAL BORROWINGS (`borrowings_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.borrowings_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('bor-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "borrowingRef_c" TEXT NOT NULL UNIQUE,
    "lender_c" JSONB,
    "borrowingDate_c" DATE NOT NULL,
    "amountBorrowed_c" NUMERIC(14,2) NOT NULL,
    "fundingType_c" TEXT NOT NULL,
    "receivedMethod_c" TEXT,
    "destinationAccount_c" TEXT,
    "purpose_c" TEXT,
    "relatedPurchase_c" TEXT,
    "interestType_c" TEXT DEFAULT 'None',
    "interestRate_c" NUMERIC(6,2) DEFAULT 0,
    "repaymentTerms_c" TEXT,
    "dueDate_c" DATE,
    "amountApplied_c" NUMERIC(14,2) DEFAULT 0,
    "amountRepaid_c" NUMERIC(14,2) DEFAULT 0,
    "outstandingPrincipal_c" NUMERIC(14,2) NOT NULL,
    "status_c" TEXT DEFAULT 'Outstanding',
    "directPaymentStatus_c" TEXT,
    "idempotencyKey_c" TEXT,
    "attachments_c" JSONB DEFAULT '[]'::jsonb,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. BORROWING REPAYMENTS (`borrowing_repayments_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.borrowing_repayments_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('repay-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "repaymentRef_c" TEXT NOT NULL UNIQUE,
    "borrowing_c" TEXT NOT NULL,
    "repaymentDate_c" DATE NOT NULL,
    "principalAmount_c" NUMERIC(14,2) DEFAULT 0,
    "interestAmount_c" NUMERIC(14,2) DEFAULT 0,
    "paymentMethod_c" TEXT NOT NULL,
    "paidFromAccount_c" TEXT,
    "idempotencyKey_c" TEXT,
    "attachments_c" JSONB DEFAULT '[]'::jsonb,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 16. OWNER CAPITAL & REPAYABLE FUNDING (`owner_funding_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_funding_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('own-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "fundingRef_c" TEXT NOT NULL UNIQUE,
    "fundingPerson_c" TEXT DEFAULT 'Business owner',
    "fundingDate_c" DATE NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "fundingTreatment_c" TEXT NOT NULL,
    "relatedPurchase_c" TEXT,
    "relatedExpense_c" TEXT,
    "amountReimbursed_c" NUMERIC(14,2) DEFAULT 0,
    "outstandingReimbursement_c" NUMERIC(14,2) NOT NULL,
    "status_c" TEXT DEFAULT 'Outstanding',
    "idempotencyKey_c" TEXT,
    "attachments_c" JSONB DEFAULT '[]'::jsonb,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 17. OWNER REIMBURSEMENTS (`owner_funding_repayments_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_funding_repayments_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('orep-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "reimbursementRef_c" TEXT NOT NULL UNIQUE,
    "ownerFunding_c" TEXT NOT NULL,
    "reimbursementDate_c" DATE NOT NULL,
    "amount_c" NUMERIC(14,2) NOT NULL,
    "paymentMethod_c" TEXT NOT NULL,
    "idempotencyKey_c" TEXT,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 18. GENERAL LEDGER TRANSACTIONS (`transactions_c`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('txn-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "entryType_c" TEXT,
    "category_c" TEXT,
    "amount_c" NUMERIC(14,2) DEFAULT 0,
    "entryDate_c" DATE,
    "paymentMethod_c" TEXT,
    "weightKg_c" NUMERIC(14,3),
    "unitPrice_c" NUMERIC(14,2),
    "counterparty_c" TEXT,
    "attachments_c" JSONB DEFAULT '[]'::jsonb,
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY & OPEN POLICIES
-- =============================================================================
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'workers_c', 'stock_items_c', 'stock_movements_c', 'purchases_c',
        'purchase_payments_c', 'purchase_audit_c', 'production_c', 'sales_c',
        'expenses_c', 'attendance_c', 'payroll_c', 'worker_payments_c',
        'lenders_c', 'borrowings_c', 'borrowing_repayments_c', 'owner_funding_c',
        'owner_funding_repayments_c', 'transactions_c'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Public access policy" ON public.%I;', tbl);
        EXECUTE format('CREATE POLICY "Public access policy" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);', tbl);
    END LOOP;
END $$;

-- =============================================================================
-- SEED INITIAL FOUNDRY DEMO DATA
-- =============================================================================

INSERT INTO public.workers_c ("Id", "Name", "role_c", "workerType_c", "payType_c", "phone_c", "dailyRate_c", "monthlySalary_c", "status_c", "isArchived_c", "joinedOn_c", "notes_c")
VALUES
('wrk-001', 'Ramesh Kumar', 'Operator', 'Regular', 'daily', '+91 98230 11223', 650.00, 19500.00, 'Active', false, '2024-01-15', 'Lead induction furnace operator.'),
('wrk-002', 'Suresh Patel', 'Machine Operator', 'Regular', 'daily', '+91 98450 33445', 750.00, 22500.00, 'Active', false, '2024-02-01', 'Molding machine operator.'),
('wrk-003', 'Vijay Singh', 'Supervisor', 'Regular', 'daily', '+91 98765 44321', 900.00, 27000.00, 'Active', false, '2023-11-10', 'Shift in-charge.'),
('wrk-004', 'Anil Verma', 'Helper', 'Temporary', 'daily', '+91 97110 55667', 500.00, 15000.00, 'Active', false, '2024-05-10', 'General helper.'),
('wrk-005', 'Mohan Lal', 'Loader', 'Regular', 'daily', '+91 98980 77889', 550.00, 16500.00, 'Active', false, '2024-03-20', 'Raw material loader.'),
('wrk-006', 'Rajesh Yadav', 'Storekeeper', 'Regular', 'daily', '+91 97230 88990', 700.00, 21000.00, 'Active', false, '2024-01-10', 'Inventory weighing keeper.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.stock_items_c ("Id", "Name", "itemCode_c", "unit_c", "status_c", "notes_c")
VALUES
('stk-001', 'Scrap Iron Grade A', 'STK-001', 'kg', 'Active', 'Heavy melting scrap for induction furnace charge.'),
('stk-002', 'Brass Scrap', 'STK-002', 'kg', 'Active', 'Honey brass scrap for bush and fitting castings.'),
('stk-003', 'Copper Wire Scrap', 'STK-003', 'kg', 'Active', 'Millberry copper scrap for high-grade alloy blending.'),
('stk-004', 'Aluminum Ingot', 'STK-004', 'kg', 'Active', 'Commercial 99.5% pure aluminum ingots.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.stock_movements_c ("Id", "Name", "movementType_c", "weightKg_c", "unitPrice_c", "totalValue_c", "movementDate_c", "stockItem_c", "supplierOrReason_c", "notes_c")
VALUES
('mov-001', 'Initial Inward - Scrap Iron Grade A', 'Stock In', 12500.000, 38.50, 481250.00, '2026-10-01', '{"Id": "stk-001", "Name": "Scrap Iron Grade A"}'::jsonb, 'National Metal Suppliers', 'Delivered by Truck MH-04-AB-1234'),
('mov-002', 'Initial Inward - Brass Scrap', 'Stock In', 3200.000, 315.00, 1008000.00, '2026-10-03', '{"Id": "stk-002", "Name": "Brass Scrap"}'::jsonb, 'Vardhman Scrap Traders', 'Honey brass lot weighbridge voucher #882'),
('mov-003', 'Production Run Charge #01', 'Stock Out', 4200.000, 38.50, 161700.00, '2026-10-10', '{"Id": "stk-001", "Name": "Scrap Iron Grade A"}'::jsonb, 'Production Charge - Cast Iron Ingot 25kg', 'Melt heat #2026-104')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.production_c ("Id", "Name", "productionDate_c", "productName_c", "rawMaterialKg_c", "producedKg_c", "notes_c", "idempotencyKey_c")
VALUES
('prod-001', 'Melt Batch #2026-101', '2026-10-10', 'Cast Iron Ingot 25kg', 4200.000, 4020.000, 'Heat cycle completed in 3h 45m. Slag loss ~4.28%.', 'PROD:20261010-01'),
('prod-002', 'Melt Batch #2026-102', '2026-10-15', 'Brass Bush 50mm', 1200.000, 1140.000, 'Centrifugal casting batch. Good grain structure.', 'PROD:20261015-02'),
('prod-003', 'Melt Batch #2026-103', '2026-10-18', 'Cast Iron Ingot 25kg', 3500.000, 3360.000, 'Heat run #2026-106. Standard foundry specifications.', 'PROD:20261018-03')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.sales_c ("Id", "Name", "saleId_c", "saleDate_c", "customerName_c", "customerContact_c", "productName_c", "weightKg_c", "unitPrice_c", "amount_c", "paymentMethod_c", "notes_c")
VALUES
('sal-001', 'Sale to Apex Engineering', 'SAL-20261012-A1098B2', '2026-10-12', 'Apex Engineering Works', '+91 98200 45678', 'Cast Iron Ingot 25kg', 2500.000, 64.00, 160000.00, 'Bank Transfer', 'Payment received in HDFC Current A/c via NEFT.'),
('sal-002', 'Sale to Modern Machinery', 'SAL-20261016-C4402F1', '2026-10-16', 'Modern Machinery Corp', '+91 98330 99881', 'Brass Bush 50mm', 450.000, 480.00, 216000.00, 'UPI', 'Advance UPI payment confirmed by customer.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.purchases_c ("Id", "Name", "purchaseRef_c", "stockItem_c", "quantityKg_c", "pricePerKg_c", "totalPurchaseValue_c", "purchaseDate_c", "supplierName_c", "supplierContact_c", "notes_c", "advanceAmount_c", "advanceDate_c", "advanceMethod_c", "cashAtPurchase_c", "onlineAtPurchase_c", "totalPaid_c", "outstandingBalance_c", "paymentStatus_c", "recordStatus_c", "revision_c", "idempotencyKey_c")
VALUES
('pur-001', 'Procurement - Scrap Iron Grade A', 'PUR-20261001-008124', '{"Id": "stk-001", "Name": "Scrap Iron Grade A"}'::jsonb, 12500.000, 38.50, 481250.00, '2026-10-01', 'National Metal Suppliers', '+91 98210 11990', 'First October consignment. 12.5 MT delivered.', 50000.00, '2026-09-28', 'Bank Transfer', 100000.00, 200000.00, 450000.00, 31250.00, 'Partially Paid', 'Active', 1, 'PUR:20261001-A1'),
('pur-002', 'Procurement - Brass Scrap', 'PUR-20261003-009452', '{"Id": "stk-002", "Name": "Brass Scrap"}'::jsonb, 3200.000, 315.00, 1008000.00, '2026-10-03', 'Vardhman Scrap Traders', '+91 98190 77112', 'High purity honey brass lot.', 200000.00, '2026-10-01', 'Bank Transfer', 308000.00, 500000.00, 1008000.00, 0.00, 'Paid', 'Active', 1, 'PUR:20261003-B2')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.expenses_c ("Id", "Name", "expenseDate_c", "amount_c", "paymentMethod_c", "notes_c")
VALUES
('exp-001', 'Induction Furnace Electricity Bill (Sep-Oct)', '2026-10-07', 48600.00, 'Bank Transfer', 'State electricity board commercial HT tariff payment.'),
('exp-002', 'Foundry Furnace Oil (1,200 Litres)', '2026-10-11', 62400.00, 'Cash', 'Delivered by Bharat Petroleum fuel tanker.'),
('exp-003', 'Casting Sand & Bentonite Binder', '2026-10-14', 18500.00, 'UPI', '25 bags bentonite + 4 tons silica sand.'),
('exp-004', 'Crane & Hoist Maintenance Service', '2026-10-17', 9800.00, 'UPI', 'Wire rope lubrication and brake pad replacement.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.attendance_c ("Id", "Name", "worker_c", "attendanceDate_c", "status_c", "hoursWorked_c", "overtimeHours_c", "wagePerDay_c", "attendanceUnits_c", "earnedWage_c", "workerTypeSnapshot_c", "attendanceKey_c", "notes_c")
VALUES
('att-001', 'ATT-Ramesh Kumar-20261022', '{"Id": "wrk-001", "Name": "Ramesh Kumar"}'::jsonb, '2026-10-22', 'Present', 8.0, 1.5, 650.00, 1.0, 650.00, 'Regular', 'wrk-001:2026-10-22', 'Furnace duty'),
('att-002', 'ATT-Suresh Patel-20261022', '{"Id": "wrk-002", "Name": "Suresh Patel"}'::jsonb, '2026-10-22', 'Present', 8.0, 0.0, 750.00, 1.0, 750.00, 'Regular', 'wrk-002:2026-10-22', 'Molding section'),
('att-003', 'ATT-Vijay Singh-20261022', '{"Id": "wrk-003", "Name": "Vijay Singh"}'::jsonb, '2026-10-22', 'Present', 8.0, 0.0, 900.00, 1.0, 900.00, 'Regular', 'wrk-003:2026-10-22', 'Shift supervision'),
('att-004', 'ATT-Anil Verma-20261022', '{"Id": "wrk-004", "Name": "Anil Verma"}'::jsonb, '2026-10-22', 'Half Day', 4.0, 0.0, 500.00, 0.5, 250.00, 'Temporary', 'wrk-004:2026-10-22', 'Left early')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.lenders_c ("Id", "Name", "phone_c", "relationship_c", "status_c", "notes_c")
VALUES
('len-001', 'Harishbhai Shah', '+91 98250 11440', 'Friend', 'Active', 'Short-term scrap liquidity provider.'),
('len-002', 'K.L. Sharma Finance', '+91 98110 88224', 'Commercial Lender', 'Active', 'Machinery financier.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.borrowings_c ("Id", "Name", "borrowingRef_c", "lender_c", "borrowingDate_c", "amountBorrowed_c", "fundingType_c", "receivedMethod_c", "destinationAccount_c", "purpose_c", "interestType_c", "interestRate_c", "repaymentTerms_c", "dueDate_c", "amountApplied_c", "amountRepaid_c", "outstandingPrincipal_c", "status_c", "directPaymentStatus_c", "idempotencyKey_c", "notes_c")
VALUES
('bor-001', 'Loan from Harishbhai Shah', 'BOR-20261002-004120', '{"Id": "len-001", "Name": "Harishbhai Shah"}'::jsonb, '2026-10-02', 250000.00, 'Received by business', 'Bank Transfer', 'Primary Bank (HDFC)', 'Purchase payment', 'Flat', 1.5, 'Repayable in 60 days', '2026-12-01', 250000.00, 50000.00, 200000.00, 'Partially Repaid', 'Settled', 'BOR:20261002-01', 'Taken for financing 12.5 MT Scrap Iron purchase.')
ON CONFLICT ("Id") DO NOTHING;

INSERT INTO public.owner_funding_c ("Id", "Name", "fundingRef_c", "fundingPerson_c", "fundingDate_c", "amount_c", "fundingTreatment_c", "amountReimbursed_c", "outstandingReimbursement_c", "status_c", "idempotencyKey_c", "notes_c")
VALUES
('own-001', 'Owner Direct Capital Injection', 'OWN-20261005-001920', 'Business owner', '2026-10-05', 150000.00, 'Repayable to owner', 50000.00, 100000.00, 'Partially Reimbursed', 'OWN:001', 'Injected from personal savings to support production rush.')
ON CONFLICT ("Id") DO NOTHING;
