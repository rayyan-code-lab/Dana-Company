import { sdk, eq } from '@/services/sdk';
import {
  addPurchasePayment,
  getPurchaseById,
  getPurchaseTotals,
  getPaymentsForPurchase,
  formatInr,
  newIdempotencyKey,
  roundMoney,
} from '@/services/purchaseWorkflow';

export const LENDER_FIELDS = ['Name', 'phone_c', 'relationship_c', 'notes_c', 'status_c'];
export const BORROWING_FIELDS = [
  'Name',
  'borrowingRef_c',
  'lender_c',
  'borrowingDate_c',
  'amountBorrowed_c',
  'receivedMethod_c',
  'destinationAccount_c',
  'purpose_c',
  'relatedPurchase_c',
  'interestRate_c',
  'interestType_c',
  'repaymentTerms_c',
  'dueDate_c',
  'notes_c',
  'attachments_c',
  'fundingType_c',
  'amountApplied_c',
  'amountRepaid_c',
  'outstandingPrincipal_c',
  'status_c',
  'directPaymentStatus_c',
  'idempotencyKey_c',
];
export const BORROWING_REPAYMENT_FIELDS = [
  'Name',
  'repaymentRef_c',
  'borrowing_c',
  'repaymentDate_c',
  'principalAmount_c',
  'interestAmount_c',
  'paymentMethod_c',
  'paidFromAccount_c',
  'notes_c',
  'attachments_c',
  'idempotencyKey_c',
];
export const OWNER_FUNDING_FIELDS = [
  'Name',
  'fundingRef_c',
  'fundingPerson_c',
  'fundingDate_c',
  'amount_c',
  'fundingTreatment_c',
  'relatedPurchase_c',
  'relatedExpense_c',
  'amountReimbursed_c',
  'outstandingReimbursement_c',
  'status_c',
  'notes_c',
  'attachments_c',
  'idempotencyKey_c',
];
export const OWNER_REPAYMENT_FIELDS = [
  'Name',
  'reimbursementRef_c',
  'ownerFunding_c',
  'reimbursementDate_c',
  'amount_c',
  'paymentMethod_c',
  'notes_c',
  'idempotencyKey_c',
];

function numeric(value) {
  return Number(value ?? 0);
}

function text(value) {
  return String(value ?? '').trim();
}

function dateStamp(value) {
  return String(value || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
}

async function fetchByKey(table, fields, keyField, key) {
  const response = await sdk.table(table)
    .select(fields)
    .where(eq(keyField, key))
    .page(1, 10)
    .fetch();
  if (!response.success) throw new Error(response.message || 'Could not verify an existing record.');
  return response.data ?? [];
}

async function createLender(input) {
  const name = text(input.lenderName_c);
  if (!name) throw new Error('Enter a lender name.');
  const found = await fetchByKey('lenders_c', LENDER_FIELDS, 'Name', name);
  if (found.length) return found[0];
  const result = await sdk.table('lenders_c').create({
    Name: name,
    phone_c: text(input.lenderPhone_c),
    relationship_c: input.lenderRelationship_c || 'Other',
    notes_c: '',
    status_c: 'Active',
  });
  if (!result.data?.length) throw new Error(result.messages?.[0] || 'Could not save lender.');
  return result.data[0];
}

export async function getLenders() {
  const result = await sdk.table('lenders_c')
    .select(LENDER_FIELDS)
    .orderBy('Name')
    .page(1, 250)
    .fetch();
  if (!result.success) throw new Error(result.message || 'Could not load lenders.');
  return result.data ?? [];
}

export async function getBorrowings() {
  const result = await sdk.table('borrowings_c')
    .select(BORROWING_FIELDS)
    .orderByDesc('borrowingDate_c')
    .page(1, 250)
    .fetch();
  if (!result.success) throw new Error(result.message || 'Could not load borrowings.');
  return result.data ?? [];
}

export async function getBorrowingById(id) {
  const result = await sdk.table('borrowings_c').select(BORROWING_FIELDS).get(id);
  if (!result.success) return null;
  return result.data;
}

export async function getBorrowingRepayments(borrowingId) {
  const result = await sdk.table('borrowing_repayments_c')
    .select(BORROWING_REPAYMENT_FIELDS)
    .where(eq('borrowing_c', borrowingId))
    .orderByDesc('repaymentDate_c')
    .page(1, 250)
    .fetch();
  if (!result.success) throw new Error(result.message || 'Could not load repayment history.');
  return result.data ?? [];
}

export async function getOwnerFunding() {
  const result = await sdk.table('owner_funding_c')
    .select(OWNER_FUNDING_FIELDS)
    .orderByDesc('fundingDate_c')
    .page(1, 250)
    .fetch();
  if (!result.success) throw new Error(result.message || 'Could not load owner-funded transactions.');
  return result.data ?? [];
}

export async function getOwnerFundingReimbursements(fundingId) {
  const result = await sdk.table('owner_funding_repayments_c')
    .select(OWNER_REPAYMENT_FIELDS)
    .where(eq('ownerFunding_c', fundingId))
    .orderByDesc('reimbursementDate_c')
    .page(1, 250)
    .fetch();
  if (!result.success) throw new Error(result.message || 'Could not load reimbursement history.');
  return result.data ?? [];
}

export async function createBorrowing(input, idempotencyKey) {
  const amount = roundMoney(numeric(input.amountBorrowed_c));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Borrowing amount must be greater than ₹0.00.');
  if (!input.borrowingDate_c) throw new Error('Choose the date the money was received.');
  if (!input.purpose_c) throw new Error('Choose the borrowing purpose.');
  if (!['Received by business', 'Paid directly to supplier'].includes(input.fundingType_c)) {
    throw new Error('Choose how the borrowed money was provided.');
  }

  const existing = await fetchByKey('borrowings_c', BORROWING_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) {
    let row = existing[0];
    if (row.fundingType_c === 'Paid directly to supplier' && row.directPaymentStatus_c !== 'Recorded') {
      try {
        await settleDirectSupplierPayment(row.Id);
        row = await getBorrowingById(row.Id) || row;
      } catch {
        return { borrowing: row, directPaymentPending: true, duplicate: true };
      }
    }
    return { borrowing: row, directPaymentPending: row.directPaymentStatus_c === 'Pending', duplicate: true };
  }

  if (input.interestRate_c !== '' && input.interestRate_c != null) {
    const rate = Number(input.interestRate_c);
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Interest rate cannot be negative.');
    if (rate > 0 && (!input.interestType_c || input.interestType_c === 'None')) {
      throw new Error('Choose the interest type when entering an interest rate.');
    }
  }
  const lender = input.lender_c
    ? { Id: input.lender_c }
    : await createLender(input);
  const purchaseId = input.relatedPurchase_c || '';
  if (input.fundingType_c === 'Paid directly to supplier') {
    if (!purchaseId) throw new Error('Select the purchase bill paid by the lender.');
    const purchase = await getPurchaseById(purchaseId);
    if (!purchase || purchase.recordStatus_c !== 'Active') throw new Error('Select an active purchase bill.');
    const payments = await getPaymentsForPurchase(purchaseId);
    const totals = getPurchaseTotals(purchase, payments);
    if (amount > totals.outstanding + 0.005) {
      throw new Error('The lender payment exceeds the supplier balance of ' + formatInr(totals.outstanding) + '.');
    }
  }

  const reference = 'BRW-' + dateStamp(input.borrowingDate_c) + '-' + newIdempotencyKey('REF').slice(-4);
  const direct = input.fundingType_c === 'Paid directly to supplier';
  const payload = {
    Name: reference,
    borrowingRef_c: reference,
    lender_c: lender.Id,
    borrowingDate_c: input.borrowingDate_c,
    amountBorrowed_c: amount,
    receivedMethod_c: direct ? 'Direct to supplier' : (input.receivedMethod_c || 'Cash'),
    destinationAccount_c: direct ? '' : text(input.destinationAccount_c),
    purpose_c: input.purpose_c,
    relatedPurchase_c: purchaseId || null,
    interestRate_c: input.interestRate_c === '' ? null : numeric(input.interestRate_c),
    interestType_c: input.interestType_c || 'None',
    repaymentTerms_c: text(input.repaymentTerms_c),
    dueDate_c: input.dueDate_c || '',
    notes_c: text(input.notes_c),
    attachments_c: sdk.storage.toCreateFormat(input.attachments_c ?? []),
    fundingType_c: input.fundingType_c,
    amountApplied_c: 0,
    amountRepaid_c: 0,
    outstandingPrincipal_c: amount,
    status_c: 'Outstanding',
    directPaymentStatus_c: direct ? 'Pending' : 'Not applicable',
    idempotencyKey_c: idempotencyKey,
  };

  const created = await sdk.table('borrowings_c').create(payload);
  if (!created.data?.length) throw new Error(created.messages?.[0] || 'Borrowing could not be saved.');
  let borrowing = created.data[0];
  if (direct) {
    try {
      await settleDirectSupplierPayment(borrowing.Id);
      borrowing = await getBorrowingById(borrowing.Id);
      return { borrowing, directPaymentPending: false, duplicate: false };
    } catch (error) {
      return { borrowing, directPaymentPending: true, directPaymentError: error.message, duplicate: false };
    }
  }
  return { borrowing, directPaymentPending: false, duplicate: false };
}

export async function settleDirectSupplierPayment(borrowingId) {
  const borrowing = await getBorrowingById(borrowingId);
  if (!borrowing) throw new Error('Borrowing record not found.');
  if (borrowing.fundingType_c !== 'Paid directly to supplier') {
    throw new Error('This borrowing was received by the business; it is not a direct supplier payment.');
  }
  const purchaseId = borrowing.relatedPurchase_c?.Id ?? borrowing.relatedPurchase_c;
  if (!purchaseId) throw new Error('This borrowing is not linked to a purchase bill.');

  const existing = await fetchByKey('purchase_payments_c', [
    'Name', 'paymentRef_c', 'purchase_c', 'paymentType_c', 'paymentMethod_c', 'amount_c',
    'paymentDate_c', 'reference_c', 'notes_c', 'idempotencyKey_c', 'directBorrowing_c', 'fundingBreakdown_c',
  ], 'directBorrowing_c', borrowing.Id);

  if (existing.length) {
    const update = await sdk.table('borrowings_c').update({
      Id: borrowing.Id,
      amountApplied_c: numeric(borrowing.amountBorrowed_c),
      directPaymentStatus_c: 'Recorded',
    });
    if (!update.data?.length) throw new Error(update.messages?.[0] || 'Payment exists, but borrowing status could not be synchronized.');
    return { payment: existing[0], duplicate: true };
  }

  const result = await addPurchasePayment(purchaseId, {
    amount_c: numeric(borrowing.amountBorrowed_c),
    paymentMethod_c: 'Direct to supplier',
    paymentDate_c: borrowing.borrowingDate_c,
    reference_c: borrowing.borrowingRef_c,
    notes_c: 'Paid directly by ' + (borrowing.lender_c?.Name || 'lender') + '. No cash or bank receipt was recorded.',
    directBorrowing_c: borrowing.Id,
    fundingAllocations: [],
  }, 'DIRECT-SUPPLIER:' + borrowing.Id);
  const update = await sdk.table('borrowings_c').update({
    Id: borrowing.Id,
    amountApplied_c: numeric(borrowing.amountBorrowed_c),
    directPaymentStatus_c: 'Recorded',
  });
  if (!update.data?.length) throw new Error(update.messages?.[0] || 'Supplier payment saved, but the borrowing status could not be synchronized.');
  return { payment: result.payment, duplicate: result.duplicate };
}

export async function recordBorrowingRepayment(borrowingId, input, idempotencyKey) {
  const principal = roundMoney(numeric(input.principalAmount_c));
  const interest = roundMoney(numeric(input.interestAmount_c));
  if (!input.repaymentDate_c) throw new Error('Choose the repayment date.');
  if (!Number.isFinite(principal) || principal < 0) throw new Error('Principal repayment cannot be negative.');
  if (!Number.isFinite(interest) || interest < 0) throw new Error('Interest cannot be negative.');
  if (principal <= 0 && interest <= 0) throw new Error('Enter a principal repayment or an interest payment.');
  if (!input.paymentMethod_c) throw new Error('Choose the payment method.');

  const existing = await fetchByKey('borrowing_repayments_c', BORROWING_REPAYMENT_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) return { repayment: existing[0], duplicate: true, summarySynced: true };

  const borrowing = await getBorrowingById(borrowingId);
  if (!borrowing || borrowing.status_c === 'Reversed') throw new Error('An active borrowing was not found.');
  const outstanding = Math.max(0, numeric(borrowing.amountBorrowed_c) - numeric(borrowing.amountRepaid_c));
  if (principal > outstanding + 0.005) {
    throw new Error('Principal exceeds the remaining balance of ' + formatInr(outstanding) + '.');
  }

  const reference = 'BRP-' + dateStamp(input.repaymentDate_c) + '-' + newIdempotencyKey('REF').slice(-4);
  const created = await sdk.table('borrowing_repayments_c').create({
    Name: reference,
    repaymentRef_c: reference,
    borrowing_c: borrowing.Id,
    repaymentDate_c: input.repaymentDate_c,
    principalAmount_c: principal,
    interestAmount_c: interest,
    paymentMethod_c: input.paymentMethod_c,
    paidFromAccount_c: text(input.paidFromAccount_c),
    notes_c: text(input.notes_c),
    attachments_c: sdk.storage.toCreateFormat(input.attachments_c ?? []),
    idempotencyKey_c: idempotencyKey,
  });
  if (!created.data?.length) throw new Error(created.messages?.[0] || 'Repayment could not be recorded.');

  const history = await getBorrowingRepayments(borrowingId);
  const repaidPrincipal = roundMoney(history.reduce((sum, row) => sum + numeric(row.principalAmount_c), 0));
  const nextOutstanding = roundMoney(Math.max(0, numeric(borrowing.amountBorrowed_c) - repaidPrincipal));
  const status = nextOutstanding <= 0.005 ? 'Fully Repaid' : repaidPrincipal > 0 ? 'Partially Repaid' : 'Outstanding';
  const updated = await sdk.table('borrowings_c').update({
    Id: borrowing.Id,
    amountRepaid_c: repaidPrincipal,
    outstandingPrincipal_c: nextOutstanding,
    status_c: status,
  });
  return { repayment: created.data[0], duplicate: false, summarySynced: Boolean(updated.data?.length) };
}

export async function createOwnerFunding(input, idempotencyKey) {
  const amount = roundMoney(numeric(input.amount_c));
  if (!text(input.fundingPerson_c)) throw new Error('Enter the owner or funding person.');
  if (!input.fundingDate_c) throw new Error('Choose the funding date.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Funding amount must be greater than ₹0.00.');
  if (!['Repayable to owner', 'Owner contribution'].includes(input.fundingTreatment_c)) {
    throw new Error('Choose whether this amount is repayable or a contribution.');
  }

  const existing = await fetchByKey('owner_funding_c', OWNER_FUNDING_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) return { funding: existing[0], duplicate: true };

  const reference = 'OWN-' + dateStamp(input.fundingDate_c) + '-' + newIdempotencyKey('REF').slice(-4);
  const repayable = input.fundingTreatment_c === 'Repayable to owner';
  const created = await sdk.table('owner_funding_c').create({
    Name: reference,
    fundingRef_c: reference,
    fundingPerson_c: text(input.fundingPerson_c),
    fundingDate_c: input.fundingDate_c,
    amount_c: amount,
    fundingTreatment_c: input.fundingTreatment_c,
    relatedPurchase_c: input.relatedPurchase_c || null,
    relatedExpense_c: text(input.relatedExpense_c),
    amountReimbursed_c: 0,
    outstandingReimbursement_c: repayable ? amount : 0,
    status_c: repayable ? 'Repayable' : 'Owner Contribution',
    notes_c: text(input.notes_c),
    attachments_c: sdk.storage.toCreateFormat(input.attachments_c ?? []),
    idempotencyKey_c: idempotencyKey,
  });
  if (!created.data?.length) throw new Error(created.messages?.[0] || 'Owner funding record could not be saved.');
  return { funding: created.data[0], duplicate: false };
}

export async function recordOwnerFundingReimbursement(fundingId, input, idempotencyKey) {
  const amount = roundMoney(numeric(input.amount_c));
  if (!input.reimbursementDate_c) throw new Error('Choose the reimbursement date.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Reimbursement must be greater than ₹0.00.');
  if (!input.paymentMethod_c) throw new Error('Choose the payment method.');

  const existing = await fetchByKey('owner_funding_repayments_c', OWNER_REPAYMENT_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) return { reimbursement: existing[0], duplicate: true, summarySynced: true };

  const response = await sdk.table('owner_funding_c').select(OWNER_FUNDING_FIELDS).get(fundingId);
  const funding = response.data;
  if (!funding || funding.fundingTreatment_c !== 'Repayable to owner') {
    throw new Error('This record is not a repayable owner-funded amount.');
  }
  const outstanding = numeric(funding.amount_c) - numeric(funding.amountReimbursed_c);
  if (amount > outstanding + 0.005) throw new Error('Reimbursement exceeds the outstanding amount of ' + formatInr(outstanding) + '.');

  const reference = 'OWNR-' + dateStamp(input.reimbursementDate_c) + '-' + newIdempotencyKey('REF').slice(-4);
  const created = await sdk.table('owner_funding_repayments_c').create({
    Name: reference,
    reimbursementRef_c: reference,
    ownerFunding_c: funding.Id,
    reimbursementDate_c: input.reimbursementDate_c,
    amount_c: amount,
    paymentMethod_c: input.paymentMethod_c,
    notes_c: text(input.notes_c),
    idempotencyKey_c: idempotencyKey,
  });
  if (!created.data?.length) throw new Error(created.messages?.[0] || 'Owner reimbursement could not be saved.');

  const history = await getOwnerFundingReimbursements(fundingId);
  const reimbursed = roundMoney(history.reduce((sum, row) => sum + numeric(row.amount_c), 0));
  const nextOutstanding = roundMoney(Math.max(0, numeric(funding.amount_c) - reimbursed));
  const status = nextOutstanding <= 0.005 ? 'Reimbursed' : reimbursed > 0 ? 'Partially Reimbursed' : 'Repayable';
  const updated = await sdk.table('owner_funding_c').update({
    Id: funding.Id,
    amountReimbursed_c: reimbursed,
    outstandingReimbursement_c: nextOutstanding,
    status_c: status,
  });
  return { reimbursement: created.data[0], duplicate: false, summarySynced: Boolean(updated.data?.length) };
}
