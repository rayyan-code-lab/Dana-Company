-- =============================================================================
-- DANA FOUNDRY COMPANY ERP - CANONICAL DATABASE VIEWS
-- Migration: 002_canonical_views.sql
-- Description: Creates server-side aggregated views for real-time inventory balances,
-- finished casting stock, procurement settlements, borrowing accounts, and worker daybook.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RAW MATERIAL INVENTORY BALANCES (`stock_balances_v`)
-- Provides real-time physical stock (inward - outward) and valuation per catalog item.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stock_balances_v AS
WITH movement_summary AS (
    SELECT 
        CASE 
            WHEN jsonb_typeof("stockItem_c") = 'object' THEN "stockItem_c"->>'Id'
            WHEN jsonb_typeof("stockItem_c") = 'string' THEN "stockItem_c"#>>'{}'
            ELSE "stockItem_c"::text
        END AS item_id,
        COALESCE(SUM(CASE WHEN "movementType_c" = 'Stock In' THEN "weightKg_c" ELSE 0 END), 0) AS total_inward_kg,
        COALESCE(SUM(CASE WHEN "movementType_c" = 'Stock Out' THEN "weightKg_c" ELSE 0 END), 0) AS total_outward_kg,
        COALESCE(SUM(CASE WHEN "movementType_c" = 'Stock In' THEN "totalValue_c" ELSE 0 END), 0) AS total_inward_value,
        COUNT("Id") AS total_movements,
        MAX("movementDate_c") AS last_movement_date
    FROM public.stock_movements_c
    GROUP BY 1
)
SELECT 
    s."Id" AS "Id",
    s."Name" AS "Name",
    s."itemCode_c" AS "itemCode_c",
    s."unit_c" AS "unit_c",
    s."status_c" AS "status_c",
    COALESCE(m.total_inward_kg, 0)::numeric(14,3) AS total_inward_kg,
    COALESCE(m.total_outward_kg, 0)::numeric(14,3) AS total_outward_kg,
    (COALESCE(m.total_inward_kg, 0) - COALESCE(m.total_outward_kg, 0))::numeric(14,3) AS balance_kg,
    COALESCE(m.total_inward_value, 0)::numeric(14,2) AS total_inward_value,
    CASE 
        WHEN COALESCE(m.total_inward_kg, 0) > 0 
        THEN ROUND((COALESCE(m.total_inward_value, 0) / m.total_inward_kg)::numeric, 2)
        ELSE 0 
    END AS weighted_avg_cost_per_kg,
    COALESCE(m.total_movements, 0) AS movement_count,
    m.last_movement_date AS last_movement_date,
    CASE 
        WHEN (COALESCE(m.total_inward_kg, 0) - COALESCE(m.total_outward_kg, 0)) <= 0 THEN 'Out of Stock'
        WHEN (COALESCE(m.total_inward_kg, 0) - COALESCE(m.total_outward_kg, 0)) < 1000 THEN 'Low Stock'
        ELSE 'In Stock'
    END AS inventory_status
FROM public.stock_items_c s
LEFT JOIN movement_summary m ON s."Id" = m.item_id;

-- -----------------------------------------------------------------------------
-- 2. FINISHED CASTING GOODS & SALES RECONCILIATION (`finished_stock_balances_v`)
-- Calculates produced kg vs sold kg per product to protect against overselling.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.finished_stock_balances_v AS
WITH prod_agg AS (
    SELECT 
        LOWER(TRIM("productName_c")) AS norm_name,
        MAX("productName_c") AS display_name,
        SUM("producedKg_c") AS total_produced_kg,
        SUM("rawMaterialKg_c") AS total_raw_consumed_kg,
        COUNT("Id") AS production_runs,
        MAX("productionDate_c") AS last_production_date
    FROM public.production_c
    GROUP BY LOWER(TRIM("productName_c"))
),
sales_agg AS (
    SELECT 
        LOWER(TRIM("productName_c")) AS norm_name,
        MAX("productName_c") AS display_name,
        SUM("weightKg_c") AS total_sold_kg,
        SUM("amount_c") AS total_sales_revenue,
        COUNT("Id") AS sales_orders,
        MAX("saleDate_c") AS last_sale_date
    FROM public.sales_c
    GROUP BY LOWER(TRIM("productName_c"))
)
SELECT 
    COALESCE(p.norm_name, s.norm_name) AS "Id",
    COALESCE(p.display_name, s.display_name) AS "Name",
    COALESCE(p.total_produced_kg, 0)::numeric(14,3) AS produced_kg,
    COALESCE(s.total_sold_kg, 0)::numeric(14,3) AS sold_kg,
    (COALESCE(p.total_produced_kg, 0) - COALESCE(s.total_sold_kg, 0))::numeric(14,3) AS balance_kg,
    COALESCE(p.total_raw_consumed_kg, 0)::numeric(14,3) AS raw_consumed_kg,
    COALESCE(s.total_sales_revenue, 0)::numeric(14,2) AS sales_revenue,
    COALESCE(p.production_runs, 0) AS production_run_count,
    COALESCE(s.sales_orders, 0) AS sales_order_count,
    p.last_production_date,
    s.last_sale_date,
    CASE 
        WHEN (COALESCE(p.total_produced_kg, 0) - COALESCE(s.total_sold_kg, 0)) <= 0 THEN 'Out of Stock'
        WHEN (COALESCE(p.total_produced_kg, 0) - COALESCE(s.total_sold_kg, 0)) < 500 THEN 'Low Stock'
        ELSE 'Available'
    END AS stock_status
FROM prod_agg p
FULL OUTER JOIN sales_agg s ON p.norm_name = s.norm_name;

-- -----------------------------------------------------------------------------
-- 3. PROCUREMENT REGISTER WITH ACCURATE SETTLEMENTS (`purchase_balances_v`)
-- Joins purchase PO with installment payments to calculate real-time outstanding balances.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.purchase_balances_v AS
WITH payments_summary AS (
    SELECT 
        "purchase_c" AS purchase_id,
        COALESCE(SUM("amount_c"), 0) AS total_installment_paid,
        COUNT("Id") AS installment_count,
        MAX("paymentDate_c") AS last_payment_date
    FROM public.purchase_payments_c
    GROUP BY "purchase_c"
)
SELECT 
    p."Id" AS "Id",
    p."Name" AS "Name",
    p."purchaseRef_c" AS "purchaseRef_c",
    p."supplierName_c" AS "supplierName_c",
    p."supplierContact_c" AS "supplierContact_c",
    p."purchaseDate_c" AS "purchaseDate_c",
    p."quantityKg_c" AS "quantityKg_c",
    p."pricePerKg_c" AS "pricePerKg_c",
    p."totalPurchaseValue_c" AS "totalPurchaseValue_c",
    (COALESCE(p."advanceAmount_c", 0) + COALESCE(p."cashAtPurchase_c", 0) + COALESCE(p."onlineAtPurchase_c", 0))::numeric(14,2) AS initial_paid_c,
    COALESCE(pay.total_installment_paid, 0)::numeric(14,2) AS installment_paid_c,
    (
        COALESCE(p."advanceAmount_c", 0) + 
        COALESCE(p."cashAtPurchase_c", 0) + 
        COALESCE(p."onlineAtPurchase_c", 0) + 
        COALESCE(pay.total_installment_paid, 0)
    )::numeric(14,2) AS total_paid_c,
    GREATEST(
        0, 
        p."totalPurchaseValue_c" - (
            COALESCE(p."advanceAmount_c", 0) + 
            COALESCE(p."cashAtPurchase_c", 0) + 
            COALESCE(p."onlineAtPurchase_c", 0) + 
            COALESCE(pay.total_installment_paid, 0)
        )
    )::numeric(14,2) AS outstanding_balance_c,
    CASE 
        WHEN (
            COALESCE(p."advanceAmount_c", 0) + 
            COALESCE(p."cashAtPurchase_c", 0) + 
            COALESCE(p."onlineAtPurchase_c", 0) + 
            COALESCE(pay.total_installment_paid, 0)
        ) >= (p."totalPurchaseValue_c" - 0.01) THEN 'Paid'
        WHEN (
            COALESCE(p."advanceAmount_c", 0) + 
            COALESCE(p."cashAtPurchase_c", 0) + 
            COALESCE(p."onlineAtPurchase_c", 0) + 
            COALESCE(pay.total_installment_paid, 0)
        ) > 0 THEN 'Partially Paid'
        ELSE 'Unpaid'
    END AS computed_payment_status,
    p."recordStatus_c" AS "recordStatus_c",
    COALESCE(pay.installment_count, 0) AS payment_count,
    pay.last_payment_date,
    p."CreatedOn" AS "CreatedOn"
FROM public.purchases_c p
LEFT JOIN payments_summary pay ON p."Id" = pay.purchase_id;

-- -----------------------------------------------------------------------------
-- 4. BORROWINGS LEDGER & REPAYMENT BALANCES (`borrowing_balances_v`)
-- Separates principal repayment from interest expense to reflect true debt.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.borrowing_balances_v AS
WITH repayments_summary AS (
    SELECT 
        "borrowing_c" AS borrowing_id,
        COALESCE(SUM("principalAmount_c"), 0) AS total_principal_repaid,
        COALESCE(SUM("interestAmount_c"), 0) AS total_interest_paid,
        COUNT("Id") AS repayment_count,
        MAX("repaymentDate_c") AS last_repayment_date
    FROM public.borrowing_repayments_c
    GROUP BY "borrowing_c"
)
SELECT 
    b."Id" AS "Id",
    b."Name" AS "Name",
    b."borrowingRef_c" AS "borrowingRef_c",
    b."lender_c" AS "lender_c",
    b."borrowingDate_c" AS "borrowingDate_c",
    b."amountBorrowed_c" AS "amountBorrowed_c",
    COALESCE(r.total_principal_repaid, 0)::numeric(14,2) AS principal_repaid_c,
    COALESCE(r.total_interest_paid, 0)::numeric(14,2) AS interest_paid_c,
    GREATEST(0, b."amountBorrowed_c" - COALESCE(r.total_principal_repaid, 0))::numeric(14,2) AS outstanding_principal_c,
    CASE 
        WHEN COALESCE(r.total_principal_repaid, 0) >= (b."amountBorrowed_c" - 0.01) THEN 'Settled'
        ELSE 'Outstanding'
    END AS computed_status,
    b."interestType_c" AS "interestType_c",
    b."interestRate_c" AS "interestRate_c",
    b."dueDate_c" AS "dueDate_c",
    COALESCE(r.repayment_count, 0) AS repayment_count,
    r.last_repayment_date
FROM public.borrowings_c b
LEFT JOIN repayments_summary r ON b."Id" = r.borrowing_id;

-- -----------------------------------------------------------------------------
-- 5. WORKER ATTENDANCE & WAGE DAYBOOK SUMMARY (`worker_attendance_summary_v`)
-- Aggregates days worked, earned wages, advances, and net balance payable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.worker_attendance_summary_v AS
WITH att_agg AS (
    SELECT 
        CASE 
            WHEN jsonb_typeof("worker_c") = 'object' THEN "worker_c"->>'Id'
            WHEN jsonb_typeof("worker_c") = 'string' THEN "worker_c"#>>'{}'
            ELSE "worker_c"::text
        END AS worker_id,
        COUNT("Id") AS total_shifts,
        SUM(CASE WHEN "status_c" IN ('Present', 'Full Day') THEN 1.0 WHEN "status_c" = 'Half Day' THEN 0.5 ELSE 0 END) AS days_present,
        SUM(CASE WHEN "status_c" = 'Absent' THEN 1 ELSE 0 END) AS days_absent,
        COALESCE(SUM("overtimeHours_c"), 0) AS total_overtime_hours,
        COALESCE(SUM("earnedWage_c"), 0) AS total_earned_wage
    FROM public.attendance_c
    GROUP BY 1
),
pay_agg AS (
    SELECT 
        CASE 
            WHEN jsonb_typeof("worker_c") = 'object' THEN "worker_c"->>'Id'
            WHEN jsonb_typeof("worker_c") = 'string' THEN "worker_c"#>>'{}'
            ELSE "worker_c"::text
        END AS worker_id,
        COALESCE(SUM(CASE WHEN "transactionType_c" = 'Advance' THEN "amount_c" ELSE 0 END), 0) AS total_advances,
        COALESCE(SUM(CASE WHEN "transactionType_c" != 'Advance' THEN "amount_c" ELSE 0 END), 0) AS total_settlements
    FROM public.worker_payments_c
    GROUP BY 1
)
SELECT 
    w."Id" AS "Id",
    w."Name" AS "Name",
    w."role_c" AS "role_c",
    w."workerType_c" AS "workerType_c",
    w."payType_c" AS "payType_c",
    w."dailyRate_c" AS "dailyRate_c",
    w."status_c" AS "status_c",
    COALESCE(a.total_shifts, 0) AS total_shifts,
    COALESCE(a.days_present, 0)::numeric(6,2) AS days_present,
    COALESCE(a.days_absent, 0) AS days_absent,
    COALESCE(a.total_overtime_hours, 0)::numeric(6,2) AS overtime_hours,
    COALESCE(a.total_earned_wage, 0)::numeric(14,2) AS earned_wages,
    COALESCE(p.total_advances, 0)::numeric(14,2) AS advances_received,
    COALESCE(p.total_settlements, 0)::numeric(14,2) AS settlements_paid,
    (
        COALESCE(a.total_earned_wage, 0) - 
        (COALESCE(p.total_advances, 0) + COALESCE(p.total_settlements, 0))
    )::numeric(14,2) AS net_balance_payable
FROM public.workers_c w
LEFT JOIN att_agg a ON w."Id" = a.worker_id
LEFT JOIN pay_agg p ON w."Id" = p.worker_id;

-- -----------------------------------------------------------------------------
-- PERMISSIONS FOR CANONICAL VIEWS
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.stock_balances_v TO anon, authenticated;
GRANT SELECT ON public.finished_stock_balances_v TO anon, authenticated;
GRANT SELECT ON public.purchase_balances_v TO anon, authenticated;
GRANT SELECT ON public.borrowing_balances_v TO anon, authenticated;
GRANT SELECT ON public.worker_attendance_summary_v TO anon, authenticated;
