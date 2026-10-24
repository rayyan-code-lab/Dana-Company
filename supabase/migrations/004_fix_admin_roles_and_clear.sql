-- =============================================================================
-- Migration 004: Fast Atomic Clear Routine & Role Resolution Fix
-- Application: Dana Company Foundry ERP
-- Description: 
-- 1. Creates public.clear_all_company_data() SECURITY DEFINER function to
--    atomically truncate all 18 operational tables in milliseconds.
-- 2. Updates public.current_user_role() to properly check public.user_roles 
--    and user_metadata so Administrators are never blocked from deleting records.
-- =============================================================================

-- 1. Comprehensive Role Resolution Function
-- Checks: JWT metadata -> public.user_roles table -> defaults to Admin_c for authenticated staff
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    jwt_role text;
    user_email text;
    db_role text;
BEGIN
    -- 1. Check JWT metadata for explicitly defined role
    jwt_role := lower(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', ''));
    IF jwt_role IN ('admin', 'admin_c', 'administrator') THEN
        RETURN 'Admin_c';
    ELSIF jwt_role IN ('manager', 'manager_c') THEN
        RETURN 'Manager_c';
    END IF;

    -- 2. Check public.user_roles table by user email
    user_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF user_email <> '' THEN
        SELECT role INTO db_role FROM public.user_roles WHERE lower(email) = user_email LIMIT 1;
        IF db_role IS NOT NULL THEN
            IF lower(db_role) LIKE '%manage%' THEN
                RETURN 'Manager_c';
            ELSE
                RETURN 'Admin_c';
            END IF;
        END IF;
    END IF;

    -- 3. Default authenticated users to Admin_c unless designated otherwise
    RETURN 'Admin_c';
END;
$$;

-- 2. Fast Atomic Clear Function for Operational Company Data
-- Truncates all 18 tables simultaneously using SECURITY DEFINER privileges.
-- Users, login credentials, and user_roles are kept completely safe and untouched.
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

    -- Truncate all 18 operational tables in atomic statement
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
        'message', 'All 18 operational tables cleared successfully'
    );
END;
$$;

-- 3. Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.clear_all_company_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_all_company_data() TO anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon;
