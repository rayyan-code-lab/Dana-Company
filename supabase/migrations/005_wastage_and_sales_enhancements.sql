-- =============================================================================
-- Migration 005: Wastage Management, Shift Timings & Sales Payment Division
-- Application: Dana Company Foundry ERP
-- =============================================================================

-- 1. ADD SHIFTS & TIMINGS TO WORKERS (workers_c)
ALTER TABLE public.workers_c 
ADD COLUMN IF NOT EXISTS "shift_c" TEXT DEFAULT 'Day Shift',
ADD COLUMN IF NOT EXISTS "shiftTiming_c" TEXT DEFAULT '09:00 AM - 09:00 PM';

-- 2. ADD SHIFTS & DAILY TIMINGS TO ATTENDANCE (attendance_c)
ALTER TABLE public.attendance_c 
ADD COLUMN IF NOT EXISTS "shift_c" TEXT DEFAULT 'Day Shift',
ADD COLUMN IF NOT EXISTS "shiftTiming_c" TEXT DEFAULT '09:00 AM - 09:00 PM';

-- 3. ADD PAYMENT DIVISION TO SALES (sales_c)
ALTER TABLE public.sales_c 
ADD COLUMN IF NOT EXISTS "paidAmount_c" NUMERIC(14,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS "balanceDue_c" NUMERIC(14,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS "paymentStatus_c" TEXT DEFAULT 'Paid';

-- Backfill existing sales to mark them as fully paid if balanceDue_c is null or 0
UPDATE public.sales_c 
SET "paidAmount_c" = COALESCE("paidAmount_c", "amount_c", 0),
    "balanceDue_c" = GREATEST(0, COALESCE("amount_c", 0) - COALESCE("paidAmount_c", "amount_c", 0)),
    "paymentStatus_c" = CASE 
        WHEN COALESCE("paidAmount_c", 0) >= COALESCE("amount_c", 0) THEN 'Paid'
        WHEN COALESCE("paidAmount_c", 0) > 0 THEN 'Partially Paid'
        ELSE 'Unpaid'
    END
WHERE "paymentStatus_c" IS NULL OR "paidAmount_c" IS NULL;

-- 4. CREATE WASTAGE TABLE (wastage_c)
CREATE TABLE IF NOT EXISTS public.wastage_c (
    "Id" TEXT PRIMARY KEY DEFAULT ('wst-' || encode(gen_random_bytes(6), 'hex')),
    "Name" TEXT,
    "recordType_c" TEXT NOT NULL DEFAULT 'Generated', -- 'Generated' or 'Sold'
    "date_c" DATE NOT NULL,
    "category_c" TEXT NOT NULL,
    "weightKg_c" NUMERIC(14,3) NOT NULL,
    "source_c" TEXT,
    "storageLocation_c" TEXT,
    "buyerName_c" TEXT,
    "buyerContact_c" TEXT,
    "ratePerKg_c" NUMERIC(14,2) DEFAULT 0,
    "revenueAmount_c" NUMERIC(14,2) DEFAULT 0,
    "paymentMethod_c" TEXT DEFAULT 'Cash',
    "notes_c" TEXT,
    "CreatedOn" TIMESTAMPTZ DEFAULT NOW(),
    "ModifiedOn" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security on wastage_c
ALTER TABLE public.wastage_c ENABLE ROW LEVEL SECURITY;

-- Drop any previous policies on wastage_c
DROP POLICY IF EXISTS "Authenticated read wastage" ON public.wastage_c;
DROP POLICY IF EXISTS "Authenticated insert wastage" ON public.wastage_c;
DROP POLICY IF EXISTS "Authenticated update wastage" ON public.wastage_c;
DROP POLICY IF EXISTS "Admin delete wastage" ON public.wastage_c;
DROP POLICY IF EXISTS "Authenticated delete wastage" ON public.wastage_c;

-- Authenticated users (Admin + Manager) can read, log, and sell waste
CREATE POLICY "Authenticated read wastage" ON public.wastage_c
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated insert wastage" ON public.wastage_c
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated update wastage" ON public.wastage_c
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

-- Authenticated users can delete scrap records added by mistake
CREATE POLICY "Authenticated delete wastage" ON public.wastage_c
FOR DELETE TO authenticated
USING (true);

-- 5. UPDATE CLEAR DATA ROUTINE TO INCLUDE WASTAGE
CREATE OR REPLACE FUNCTION public.clear_all_company_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify role: only Admin_c can execute full database wipe
    IF public.current_user_role() = 'Manager_c' THEN
        RAISE EXCEPTION 'Permission denied: Manager profiles cannot clear company data.';
    END IF;

    -- Truncate all 19 operational tables in atomic statement (including wastage_c)
    TRUNCATE TABLE 
        public.purchase_payments_c,
        public.purchase_audit_c,
        public.stock_movements_c,
        public.worker_payments_c,
        public.borrowing_repayments_c,
        public.owner_funding_repayments_c,
        public.transactions_c,
        public.attendance_c,
        public.payroll_c,
        public.sales_c,
        public.wastage_c,
        public.expenses_c,
        public.production_c,
        public.purchases_c,
        public.borrowings_c,
        public.owner_funding_c,
        public.stock_items_c,
        public.lenders_c,
        public.workers_c
    RESTART IDENTITY CASCADE;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'All 19 operational tables cleared successfully'
    );
END;
$$;

-- 6. Seed initial common wastage categories if empty
INSERT INTO public.wastage_c ("Id", "Name", "recordType_c", "date_c", "category_c", "weightKg_c", "source_c", "storageLocation_c", "notes_c")
VALUES 
('wst-001', 'Runner & Riser Scrap · 320 kg', 'Generated', CURRENT_DATE - INTERVAL '3 days', 'Runner & Riser Scrap', 320.000, 'Furnace Heat #12', 'Scrap Bay A', 'Foundry casting gates and risers'),
('wst-002', 'Defective Casting Scrap · 150 kg', 'Generated', CURRENT_DATE - INTERVAL '2 days', 'Defective / Rejection Castings', 150.000, 'Inspection rejection', 'Storage Bin 2', 'Porosity in hub castings'),
('wst-003', 'Slag & Dross · 200 kg', 'Generated', CURRENT_DATE - INTERVAL '1 day', 'Slag & Dross', 200.000, 'Furnace Deslagging', 'Slag Dump Yard', 'Slag residue from melting')
ON CONFLICT ("Id") DO NOTHING;

