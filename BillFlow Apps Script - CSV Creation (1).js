/**
 * BillFlow — Google Apps Script Backend (v5 — UPDATED)
 * ================================================
 * ALL actions go through doGet to avoid CORS issues with browsers.
 * Data is passed as a URL-encoded "payload" parameter.
 *
 * Deploy as Web App:
 *   Extensions → Apps Script → Deploy → New Deployment
 *   Type: Web App | Execute as: Me | Access: Anyone
 *
 * !! IMPORTANT: Update PRODUCTS_SHEET_NAME below to match
 *    the exact name of your products tab in Google Sheets !!
 *
 * FIXES vs previous version:
 *   1. saveInvoice  — now writes PaymentMode, PaymentStatus, AmountPaid (cols L-N)
 *   2. getInvoices  — now returns full invoice fields + fetches InvoiceItems
 *   3. saveProduct  — new action: upsert a product row in the Products sheet
 *   4. deleteProduct— new action: delete a product row from the Products sheet
 */

// ── UPDATE THIS to match your exact Products tab name ───────────
const PRODUCTS_SHEET_NAME = 'Billflow Products';
// ────────────────────────────────────────────────────────────────

const SHEET_NAMES = {
  PRODUCTS:      PRODUCTS_SHEET_NAME,
  CUSTOMERS:     'Customers',
  INVOICES:      'Invoices',
  INVOICE_ITEMS: 'InvoiceItems',
};

// ─── MAIN ROUTER (everything via GET to avoid CORS) ────────────
function doGet(e) {
  const action  = e.parameter.action  || 'getProducts';
  const payload = e.parameter.payload || null;

  let result;
  try {
    switch (action) {
      case 'getProducts':   result = getProducts();  break;
      case 'getCustomers':  result = getCustomers(); break;
      case 'getInvoices':   result = getInvoices();  break;
      case 'saveInvoice':
        result = saveInvoice(JSON.parse(decodeURIComponent(payload)));
        break;
      case 'saveCustomer':
        result = saveCustomer(JSON.parse(decodeURIComponent(payload)));
        break;
      // FIX 3: new action — create or update a product
      case 'saveProduct':
        result = saveProduct(JSON.parse(decodeURIComponent(payload)));
        break;
      // FIX 4: new action — delete a product by id
      case 'deleteProduct':
        result = deleteProduct(JSON.parse(decodeURIComponent(payload)));
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── PRODUCTS ──────────────────────────────────────────────────
function getProducts() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);

  if (!sheet) {
    const available = ss.getSheets().map(s => s.getName()).join(', ');
    return {
      error: 'Sheet "' + SHEET_NAMES.PRODUCTS + '" not found.',
      availableSheets: available
    };
  }

  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { products: [] };

  const headers  = rows[0].map(h => h.toString().toLowerCase().trim());
  const idIdx    = Math.max(headers.indexOf('id'), 0);
  const nameIdx  = Math.max(headers.indexOf('name'), 1);
  const priceIdx = Math.max(headers.indexOf('price'), 2);
  const stockIdx = Math.max(headers.indexOf('stock'), 3);

  const products = rows.slice(1)
    .filter(r => r[idIdx])
    .map(r => ({
      id:    String(r[idIdx]    || ''),
      name:  String(r[nameIdx]  || ''),
      price: parseFloat(r[priceIdx]) || 0,
      stock: parseInt(r[stockIdx])   || 0,
    }))
    .filter(p => p.name);

  return { products };
}

// FIX 3: Upsert a product row in the Products sheet
function saveProduct(p) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
  if (!sheet) return { error: 'Products sheet not found.' };

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => h.toString().toLowerCase().trim());
  const idIdx   = headers.indexOf('id');
  const nameIdx = headers.indexOf('name');
  const priceIdx= headers.indexOf('price');
  const stockIdx= headers.indexOf('stock');

  // Find existing row by id
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx]) === String(p.id)) {
      // Update in place
      sheet.getRange(i + 1, idIdx    + 1).setValue(p.id);
      sheet.getRange(i + 1, nameIdx  + 1).setValue(p.name);
      sheet.getRange(i + 1, priceIdx + 1).setValue(p.price);
      sheet.getRange(i + 1, stockIdx + 1).setValue(p.stock);
      return { success: true, updated: true };
    }
  }

  // New product — append
  const newRow = [];
  newRow[idIdx]    = p.id;
  newRow[nameIdx]  = p.name;
  newRow[priceIdx] = p.price;
  newRow[stockIdx] = p.stock;
  sheet.appendRow(newRow);
  return { success: true, created: true };
}

// FIX 4: Delete a product row by id
function deleteProduct(p) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PRODUCTS);
  if (!sheet) return { error: 'Products sheet not found.' };

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => h.toString().toLowerCase().trim());
  const idIdx   = headers.indexOf('id');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idIdx]) === String(p.id)) {
      sheet.deleteRow(i + 1);
      return { success: true, deleted: true };
    }
  }
  return { error: 'Product not found: ' + p.id };
}

// ─── CUSTOMERS ─────────────────────────────────────────────────
function getCustomers() {
  const sheet = getOrCreateSheet(SHEET_NAMES.CUSTOMERS,
    ['ID', 'Name', 'Phone', 'Email', 'Address', 'GSTIN']);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { customers: [] };

  const customers = rows.slice(1).filter(r => r[0]).map(r => ({
    id:      String(r[0]),
    name:    String(r[1] || ''),
    phone:   String(r[2] || ''),
    email:   String(r[3] || ''),
    address: String(r[4] || ''),
    gstin:   String(r[5] || ''),
  }));
  return { customers };
}

function saveCustomer(c) {
  const sheet = getOrCreateSheet(SHEET_NAMES.CUSTOMERS,
    ['ID', 'Name', 'Phone', 'Email', 'Address', 'GSTIN']);
  const rows = sheet.getDataRange().getValues();
  const idx  = rows.findIndex(
    r => r[1] && r[1].toString().toLowerCase() === c.name.toLowerCase()
  );

  if (idx > 0) {
    sheet.getRange(idx + 1, 1, 1, 6).setValues([[
      rows[idx][0], c.name, c.phone || '',
      c.email || '', c.address || '', c.gstin || ''
    ]]);
    return { success: true, updated: true };
  }

  const id = 'CUST-' + String(rows.length).padStart(4, '0');
  sheet.appendRow([id, c.name, c.phone || '',
    c.email || '', c.address || '', c.gstin || '']);
  return { success: true, id };
}

// ─── INVOICES ──────────────────────────────────────────────────

// FIX 1 & 2: getOrCreateSheet now uses the full 14-column header.
// getInvoices now returns all payment fields AND fetches InvoiceItems.
function getInvoices() {
  const sheet = getOrCreateSheet(SHEET_NAMES.INVOICES,
    ['InvoiceID','CustomerName','Phone','Email',
     'Subtotal','Discount','GST%','GSTAmount','Total','Date','Time',
     'PaymentMode','PaymentStatus','AmountPaid']);

  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { invoices: [], items: [] };

  const invoices = rows.slice(1).filter(r => r[0])
    .reverse().slice(0, 50)
    .map(r => ({
      id:            String(r[0]),
      customer:      String(r[1] || ''),
      phone:         String(r[2] || ''),
      email:         String(r[3] || ''),
      subtotal:      parseFloat(r[4]) || 0,
      discount:      parseFloat(r[5]) || 0,
      gstRate:       parseFloat(r[6]) || 0,
      gst:           parseFloat(r[7]) || 0,
      total:         parseFloat(r[8]) || 0,
      date:          String(r[9]  || ''),
      time:          String(r[10] || ''),
      paymentMode:   String(r[11] || 'Cash'),
      paymentStatus: String(r[12] || 'Paid'),
      amountPaid:    parseFloat(r[13]) || 0,
    }));

  // Also return InvoiceItems so the frontend Data tab can display them
  const items = getInvoiceItems();

  return { invoices, items };
}

function getInvoiceItems() {
  const sheet = getOrCreateSheet(SHEET_NAMES.INVOICE_ITEMS,
    ['InvoiceID','ProductID','ProductName','Quantity','UnitPrice','Subtotal']);
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  return rows.slice(1).filter(r => r[0]).map(r => ({
    invoiceId:   String(r[0]),
    productId:   String(r[1] || ''),
    productName: String(r[2] || ''),
    quantity:    parseInt(r[3])    || 0,
    unitPrice:   parseFloat(r[4]) || 0,
    subtotal:    parseFloat(r[5]) || 0,
  }));
}

// FIX 1: saveInvoice now writes all 14 columns including PaymentMode, PaymentStatus, AmountPaid
function saveInvoice(inv) {
  // 1. Invoice header row — full 14-column schema
  const invSheet = getOrCreateSheet(SHEET_NAMES.INVOICES,
    ['InvoiceID','CustomerName','Phone','Email',
     'Subtotal','Discount','GST%','GSTAmount','Total','Date','Time',
     'PaymentMode','PaymentStatus','AmountPaid']);

  invSheet.appendRow([
    inv.id,
    inv.customer      || '',
    inv.phone         || '',
    inv.email         || '',
    inv.subtotal      || 0,
    inv.discount      || 0,
    inv.gstRate       || 0,
    inv.gst           || 0,
    inv.total         || 0,
    inv.date          || '',
    inv.time          || '',
    inv.paymentMode   || 'Cash',      // FIX: was missing
    inv.paymentStatus || 'Paid',      // FIX: was missing
    inv.amountPaid    != null ? inv.amountPaid : (inv.total || 0), // FIX: was missing
  ]);

  // 2. Line items
  const itemsSheet = getOrCreateSheet(SHEET_NAMES.INVOICE_ITEMS,
    ['InvoiceID','ProductID','ProductName','Quantity','UnitPrice','Subtotal']);
  if (inv.items && inv.items.length > 0) {
    const rows = inv.items.map(i => [
      inv.id, i.id, i.name, i.qty, i.price, i.subtotal
    ]);
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, rows.length, 6)
      .setValues(rows);
  }

  // 3. Deduct stock (only if not explicitly skipped)
  if (!inv.skipStockDeduct) {
    deductStock(inv.items || []);
  }

  // 4. Save / update customer record
  if (inv.customer && inv.customer !== 'Walk-in Customer') {
    saveCustomer({
      name:    inv.customer,
      phone:   inv.phone,
      email:   inv.email,
      address: inv.address,
      gstin:   inv.gstin,
    });
  }

  return { success: true, invoiceId: inv.id };
}

// ─── STOCK ─────────────────────────────────────────────────────
function deductStock(items) {
  if (!items.length) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(SHEET_NAMES.PRODUCTS);
  if (!sheet) return;

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0].map(h => h.toString().toLowerCase().trim());
  const idCol   = headers.indexOf('id');
  const stCol   = headers.indexOf('stock');
  if (stCol === -1) return;

  items.forEach(item => {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]) === String(item.id)) {
        const newStock = Math.max(0, (parseInt(rows[i][stCol]) || 0) - item.qty);
        sheet.getRange(i + 1, stCol + 1).setValue(newStock);
        break;
      }
    }
  });
}

// ─── UTILITY ───────────────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const r = sheet.getRange(1, 1, 1, headers.length);
    r.setValues([headers]);
    r.setBackground('#e8e8ff');
    r.setFontWeight('bold');
    sheet.setFrozenRows(1);
    headers.forEach((_, i) => sheet.setColumnWidth(i + 1, 160));
  }
  return sheet;
}

// ─── TEST — run this in editor to verify sheet is found ────────
function testConnection() {
  const result = getProducts();
  Logger.log(JSON.stringify(result));
  // Check Execution log — should show your products
}
