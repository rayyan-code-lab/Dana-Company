-- =============================================================================
-- Migration 003: Authoritative Row-Level Security (RLS) Lockdown & Role Controls
-- Application: Dana Company Foundry ERP
-- Description: Revokes public anonymous access and implements strict role-based
--              access control (Admin_c vs Manager_c) directly in PostgreSQL.
-- =============================================================================

-- 1. Helper function to extract normalized role from Supabase Auth JWT
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE 
        WHEN lower(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('admin', 'admin_c') THEN 'Admin_c'
        ELSE 'Manager_c'
    END;
$$;

-- 2. Drop the legacy open "Public access policy" from all tables
DO $$
DECLARE
    tbl text;
    all_tables text[] := ARRAY[
        'workers_c', 'stock_items_c', 'stock_movements_c', 'purchases_c',
        'purchase_payments_c', 'purchase_audit_c', 'production_c', 'sales_c',
        'expenses_c', 'attendance_c', 'payroll_c', 'worker_payments_c',
        'lenders_c', 'borrowings_c', 'borrowing_repayments_c', 'owner_funding_c',
        'owner_funding_repayments_c', 'transactions_c'
    ];
BEGIN
    FOREACH tbl IN ARRAY all_tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Public access policy" ON public.%I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Authenticated read policy" ON public.%I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Authenticated insert policy" ON public.%I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Authenticated update policy" ON public.%I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Admin delete policy" ON public.%I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Admin full policy" ON public.%I;', tbl);
    END LOOP;
END $$;

-- =============================================================================
-- 3. RESTRICT EXECUTIVE & SENSITIVE FINANCIAL TABLES (Admin_c ONLY)
--    Tables: lenders_c, borrowings_c, borrowing_repayments_c, 
--            owner_funding_c, owner_funding_repayments_c
-- =============================================================================
DO $$
DECLARE
    tbl text;
    exec_tables text[] := ARRAY[
        'lenders_c', 'borrowings_c', 'borrowing_repayments_c', 
        'owner_funding_c', 'owner_funding_repayments_c'
    ];
BEGIN
    FOREACH tbl IN ARRAY exec_tables LOOP
        EXECUTE format('
            CREATE POLICY "Admin full policy" ON public.%I
            FOR ALL TO authenticated
            USING (public.current_user_role() = ''Admin_c'')
            WITH CHECK (public.current_user_role() = ''Admin_c'');
        ', tbl);
    END LOOP;
END $$;

-- =============================================================================
-- 4. RESTRICT HISTORICAL PAYROLL STATEMENTS (Admin Write, Manager Read-Only)
--    Table: payroll_c
-- =============================================================================
CREATE POLICY "Authenticated read payroll" ON public.payroll_c
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admin write payroll" ON public.payroll_c
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() = 'Admin_c');

CREATE POLICY "Admin update payroll" ON public.payroll_c
FOR UPDATE TO authenticated
USING (public.current_user_role() = 'Admin_c')
WITH CHECK (public.current_user_role() = 'Admin_c');

CREATE POLICY "Admin delete payroll" ON public.payroll_c
FOR DELETE TO authenticated
USING (public.current_user_role() = 'Admin_c');

-- =============================================================================
-- 5. SECURE OPERATIONAL TABLES (Authenticated Read/Write, Admin-Only Delete)
--    Tables: production_c, stock_items_c, stock_movements_c, purchases_c,
--            purchase_payments_c, purchase_audit_c, sales_c, expenses_c,
--            workers_c, attendance_c, worker_payments_c, transactions_c
-- =============================================================================
DO $$
DECLARE
    tbl text;
    op_tables text[] := ARRAY[
        'production_c', 'stock_items_c', 'stock_movements_c', 'purchases_c',
        'purchase_payments_c', 'purchase_audit_c', 'sales_c', 'expenses_c',
        'workers_c', 'attendance_c', 'worker_payments_c', 'transactions_c'
    ];
BEGIN
    FOREACH tbl IN ARRAY op_tables LOOP
        -- Authenticated users (Admin + Manager) can read operational records
        EXECUTE format('
            CREATE POLICY "Authenticated read policy" ON public.%I
            FOR SELECT TO authenticated
            USING (true);
        ', tbl);

        -- Authenticated users (Admin + Manager) can insert operational records
        EXECUTE format('
            CREATE POLICY "Authenticated insert policy" ON public.%I
            FOR INSERT TO authenticated
            WITH CHECK (true);
        ', tbl);

        -- Authenticated users (Admin + Manager) can update operational records
        EXECUTE format('
            CREATE POLICY "Authenticated update policy" ON public.%I
            FOR UPDATE TO authenticated
            USING (true)
            WITH CHECK (true);
        ', tbl);

        -- STRICT CONTROL: ONLY Admin_c can permanently delete operational records
        EXECUTE format('
            CREATE POLICY "Admin delete policy" ON public.%I
            FOR DELETE TO authenticated
            USING (public.current_user_role() = ''Admin_c'');
        ', tbl);
    END LOOP;
END $$;
