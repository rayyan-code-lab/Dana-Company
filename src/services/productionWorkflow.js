import { sdk, eq } from '@/services/sdk';
import { getRawMaterialLedger } from '@/services/purchaseWorkflow';

const PRODUCTION_FIELDS = [
  'Name',
  'productionDate_c',
  'productName_c',
  'rawMaterialKg_c',
  'producedKg_c',
  'notes_c',
  'idempotencyKey_c',
];

const PRODUCED_SALE_FIELDS = ['Name', 'saleId_c', 'productName_c', 'weightKg_c'];
const MOVEMENT_FIELDS = ['Name', 'movementType_c', 'weightKg_c', 'stockItem_c', 'movementKey_c'];
const TOLERANCE = 0.0005;

const roundKg = (value) => Math.round(Number(value ?? 0) * 1000) / 1000;

export const normalizeProductName = (value) => String(value ?? '').trim().toLowerCase();

async function fetchByKey(table, fields, keyField, key) {
  const response = await sdk.table(table)
    .select(fields)
    .where(eq(keyField, key))
    .page(1, 10)
    .fetch();

  if (!response.success) throw new Error(response.message || 'Could not verify the existing record.');
  return response.data ?? [];
}

async function fetchAll(table, fields) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const response = await sdk.table(table)
      .select(fields)
      .orderBy('CreatedOn')
      .page(page, 100)
      .fetch();

    if (!response.success) throw new Error(response.message || 'Could not load ' + table + '.');
    const batch = response.data ?? [];
    rows.push(...batch);
    if (!response.hasMore || !batch.length) break;
  }
  return rows;
}

export async function getProducedStockBalances() {
  try {
    const viewResponse = await sdk.table('finished_stock_balances_v').fetch();
    if (viewResponse.success && Array.isArray(viewResponse.data) && viewResponse.data.length > 0) {
      return viewResponse.data.map((row) => ({
        key: row.Id,
        name: row.Name,
        produced: roundKg(row.produced_kg ?? 0),
        sold: roundKg(row.sold_kg ?? 0),
        balance: roundKg(row.balance_kg ?? 0),
        salesRevenue: Number(row.sales_revenue ?? 0),
        stockStatus: row.stock_status,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch {
    // Fall back to client-side aggregation
  }

  const [productions, sales] = await Promise.all([
    fetchAll('production_c', PRODUCTION_FIELDS),
    fetchAll('sales_c', PRODUCED_SALE_FIELDS),
  ]);

  const products = new Map();
  const productFor = (name) => {
    const key = normalizeProductName(name);
    if (!products.has(key)) {
      products.set(key, { key, name: String(name).trim(), produced: 0, sold: 0 });
    }
    return products.get(key);
  };

  productions.forEach((row) => {
    if (!normalizeProductName(row.productName_c)) return;
    productFor(row.productName_c).produced += Number(row.producedKg_c ?? 0);
  });

  sales.forEach((row) => {
    if (!normalizeProductName(row.productName_c)) return;
    productFor(row.productName_c).sold += Number(row.weightKg_c ?? 0);
  });

  return [...products.values()]
    .map((product) => ({
      key: product.key,
      name: product.name,
      produced: roundKg(product.produced),
      sold: roundKg(product.sold),
      balance: roundKg(product.produced - product.sold),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function assertProducedStockAvailable(productName, quantityKg) {
  const key = normalizeProductName(productName);
  const balances = await getProducedStockBalances();
  const available = roundKg(balances.find((item) => item.key === key)?.balance ?? 0);

  if (roundKg(quantityKg) > available + TOLERANCE) {
    throw new Error(
      'Only ' + available.toLocaleString('en-IN') + ' kg of ' + String(productName).trim()
      + ' is in stock. Reduce the quantity or record more production first.'
    );
  }
  return available;
}

const SALE_WRITE_FIELDS = ['saleDate_c', 'customerName_c', 'customerContact_c', 'productName_c', 'weightKg_c', 'unitPrice_c', 'amount_c', 'paymentMethod_c', 'notes_c'];

function assertNoOversell(balances, productName) {
  const key = normalizeProductName(productName);
  const balance = roundKg(balances.find((item) => item.key === key)?.balance ?? 0);
  if (balance < -TOLERANCE) {
    throw new Error(
      'Another sale or stock change used the same ' + String(productName).trim()
      + ' at the same time. Refresh and check the stock before trying again.'
    );
  }
}

async function rollbackSale(sale) {
  const removed = await sdk.table('sales_c').remove(sale.Id);
  if (removed.messages?.length) {
    throw new Error(
      'Sale ' + (sale.saleId_c || sale.Id) + ' went over the available stock and could not be removed automatically. Ask an administrator to delete it.'
    );
  }
}

async function restoreSale(original) {
  const restore = { Id: original.Id };
  SALE_WRITE_FIELDS.forEach((field) => { restore[field] = original[field] ?? null; });
  const response = await sdk.table('sales_c').update(restore);
  if (!response.data?.length) {
    throw new Error(
      'The sale went over the available stock and its previous values could not be restored. Refresh and check sale ' + (original.saleId_c || original.Id) + '.'
    );
  }
}

export async function recordSale(payload) {
  await assertProducedStockAvailable(payload.productName_c, payload.weightKg_c);
  const response = await sdk.table('sales_c').create(payload);
  if (!response.data?.length) throw new Error(response.messages?.[0] || 'The sale was not saved.');

  const sale = response.data[0];
  const balances = await getProducedStockBalances();
  try {
    assertNoOversell(balances, payload.productName_c);
  } catch (error) {
    await rollbackSale(sale);
    throw error;
  }
  return sale;
}

export async function updateSale(original, payload) {
  const key = normalizeProductName(payload.productName_c);
  const ownKey = normalizeProductName(original.productName_c);
  const balances = await getProducedStockBalances();
  const current = roundKg(
    (balances.find((item) => item.key === key)?.balance ?? 0)
    + (key === ownKey ? Number(original.weightKg_c ?? 0) : 0)
  );
  if (roundKg(payload.weightKg_c) > current + TOLERANCE) {
    throw new Error('Only ' + current.toLocaleString('en-IN') + ' kg of ' + String(payload.productName_c).trim() + ' is in stock for this sale.');
  }

  const response = await sdk.table('sales_c').update({ Id: original.Id, ...payload });
  if (!response.data?.length) throw new Error(response.messages?.[0] || 'The sale was not updated.');

  const after = await getProducedStockBalances();
  try {
    assertNoOversell(after, payload.productName_c);
  } catch (error) {
    await restoreSale(original);
    throw error;
  }
  return response.data[0];
}

export async function getProductionConsumption(recordId) {
  const rows = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', 'PRODUCTION:' + recordId);
  const row = rows[0];
  if (!row) return null;
  return {
    stockItemId: String(row.stockItem_c?.Id ?? row.stockItem_c ?? ''),
    weightKg: roundKg(row.weightKg_c),
  };
}

async function syncProductionConsumption(record, stockItemId) {
  const movementKey = 'PRODUCTION:' + record.Id;
  const values = {
    Name: 'Production stock-out · ' + record.productName_c,
    movementType_c: 'Stock Out',
    weightKg_c: roundKg(record.rawMaterialKg_c),
    unitPrice_c: 0,
    totalValue_c: 0,
    movementDate_c: record.productionDate_c,
    supplierOrReason_c: 'Production · ' + record.productName_c,
    notes_c: 'Raw material consumed by production record for ' + record.productName_c + '.',
    stockItem_c: String(stockItemId),
  };

  const existing = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', movementKey);
  if (existing.length) {
    const current = existing[0];
    const currentItemId = String(current.stockItem_c?.Id ?? current.stockItem_c ?? '');
    if (
      roundKg(current.weightKg_c) === values.weightKg_c
      && currentItemId === values.stockItem_c
      && current.movementDate_c === values.movementDate_c
    ) {
      return current;
    }
    const updated = await sdk.table('stock_movements_c').update({ Id: current.Id, ...values });
    if (!updated.data?.length) {
      throw new Error(updated.messages?.[0] || 'The raw material deduction could not be updated.');
    }
    return updated.data[0];
  }

  const response = await sdk.table('stock_movements_c').create({
    ...values,
    purchaseId_c: '',
    movementKey_c: movementKey,
  });
  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Production saved, but the raw material deduction could not be recorded.');
  }
  return response.data[0];
}

async function ensureConsumptionReversal(record, consumption) {
  const movementKey = 'PRODUCTION-REVERSAL:' + record.Id;
  const existing = await fetchByKey('stock_movements_c', MOVEMENT_FIELDS, 'movementKey_c', movementKey);
  if (existing.length) return existing[0];

  const response = await sdk.table('stock_movements_c').create({
    Name: 'Production reversal · ' + record.productName_c,
    movementType_c: 'Stock In',
    weightKg_c: consumption.weightKg,
    unitPrice_c: 0,
    totalValue_c: 0,
    movementDate_c: record.productionDate_c,
    supplierOrReason_c: 'Production deleted · ' + record.productName_c,
    notes_c: 'Raw material returned when a production record was deleted.',
    stockItem_c: consumption.stockItemId,
    purchaseId_c: '',
    movementKey_c: movementKey,
  });
  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'The raw material could not be returned to stock.');
  }
  return response.data[0];
}

function readProductionInput(input) {
  const productName = String(input.productName_c ?? '').trim();
  const rawKg = roundKg(input.rawMaterialKg_c);
  const producedKg = roundKg(input.producedKg_c);
  const stockItemId = String(input.stockItem_c ?? '');

  if (!productName) throw new Error('Enter the product name.');
  if (!stockItemId) throw new Error('Choose the raw material consumed.');
  if (!(rawKg > 0)) throw new Error('Raw material consumed must be greater than zero.');
  if (!(producedKg > 0)) throw new Error('Quantity produced must be greater than zero.');
  return { productName, rawKg, producedKg, stockItemId };
}

export async function createProductionRecord(input, idempotencyKey) {
  const { productName, rawKg, producedKg, stockItemId } = readProductionInput(input);

  const existing = await fetchByKey('production_c', PRODUCTION_FIELDS, 'idempotencyKey_c', idempotencyKey);
  if (existing.length) {
    await syncProductionConsumption(existing[0], stockItemId);
    return { record: existing[0], duplicate: true };
  }

  const ledger = await getRawMaterialLedger();
  const item = ledger.items.find((entry) => entry.id === stockItemId);
  const available = roundKg(item?.balance ?? 0);
  if (rawKg > available + TOLERANCE) {
    throw new Error('Only ' + available.toLocaleString('en-IN') + ' kg of ' + (item?.name ?? 'this raw material') + ' is in stock.');
  }

  const response = await sdk.table('production_c').create({
    Name: productName + ' · ' + input.productionDate_c,
    productionDate_c: input.productionDate_c,
    productName_c: productName,
    rawMaterialKg_c: rawKg,
    producedKg_c: producedKg,
    notes_c: String(input.notes_c ?? '').trim(),
    idempotencyKey_c: idempotencyKey,
  });

  if (!response.data?.length) {
    throw new Error(response.messages?.[0] || 'Production record could not be saved.');
  }

  const record = response.data[0];
  await syncProductionConsumption(record, stockItemId);
  return { record, duplicate: false };
}

async function restoreProduction(original) {
  const response = await sdk.table('production_c').update({
    Id: original.Id,
    Name: original.Name,
    productionDate_c: original.productionDate_c,
    productName_c: original.productName_c,
    rawMaterialKg_c: original.rawMaterialKg_c,
    producedKg_c: original.producedKg_c,
    notes_c: original.notes_c ?? '',
  });
  if (!response.data?.length) {
    throw new Error('The production record went over the available stock and its previous values could not be restored. Refresh and check the record.');
  }
}

export async function updateProductionRecord(original, input) {
  const { productName, rawKg, producedKg, stockItemId } = readProductionInput(input);
  const originalKey = normalizeProductName(original.productName_c);
  const newKey = normalizeProductName(productName);
  const originalKg = roundKg(original.producedKg_c);

  const balances = await getProducedStockBalances();
  const oldProduct = balances.find((item) => item.key === originalKey);
  const soldKg = roundKg(oldProduct?.sold ?? 0);
  const remainingKg = roundKg(
    (oldProduct?.produced ?? 0) - originalKg + (originalKey === newKey ? producedKg : 0)
  );
  if (remainingKg < soldKg - TOLERANCE) {
    throw new Error(
      String(original.productName_c).trim() + ' already has ' + soldKg.toLocaleString('en-IN')
      + ' kg sold, so its produced quantity cannot drop below that.'
    );
  }

  const consumption = await getProductionConsumption(original.Id);
  const ledger = await getRawMaterialLedger();
  const item = ledger.items.find((entry) => entry.id === stockItemId);
  let available = roundKg(item?.balance ?? 0);
  if (consumption && consumption.stockItemId === stockItemId) available = roundKg(available + consumption.weightKg);
  if (rawKg > available + TOLERANCE) {
    throw new Error('Only ' + available.toLocaleString('en-IN') + ' kg of ' + (item?.name ?? 'this raw material') + ' is in stock.');
  }

  const response = await sdk.table('production_c').update({
    Id: original.Id,
    Name: productName + ' · ' + input.productionDate_c,
    productionDate_c: input.productionDate_c,
    productName_c: productName,
    rawMaterialKg_c: rawKg,
    producedKg_c: producedKg,
    notes_c: String(input.notes_c ?? '').trim(),
  });
  if (!response.data?.length) throw new Error(response.messages?.[0] || 'Production record could not be updated.');

  const saved = { ...original, ...response.data[0], productName_c: productName, productionDate_c: input.productionDate_c, rawMaterialKg_c: rawKg };
  const after = await getProducedStockBalances();
  try {
    if (originalKey !== newKey) assertNoOversell(after, original.productName_c);
    assertNoOversell(after, productName);
  } catch (error) {
    await restoreProduction(original);
    throw error;
  }

  await syncProductionConsumption(saved, stockItemId);
  return saved;
}

export async function deleteProductionRecord(record) {
  const key = normalizeProductName(record.productName_c);
  const balances = await getProducedStockBalances();
  const product = balances.find((item) => item.key === key);
  const remainingKg = roundKg((product?.produced ?? 0) - Number(record.producedKg_c ?? 0));
  const soldKg = roundKg(product?.sold ?? 0);
  if (remainingKg < soldKg - TOLERANCE) {
    throw new Error(
      String(record.productName_c).trim() + ' already has ' + soldKg.toLocaleString('en-IN')
      + ' kg sold, so this production record cannot be deleted.'
    );
  }

  const consumption = await getProductionConsumption(record.Id);
  if (consumption) await ensureConsumptionReversal(record, consumption);

  const response = await sdk.table('production_c').remove(record.Id);
  if (response.messages?.length) throw new Error(response.messages[0]);
}