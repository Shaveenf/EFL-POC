import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================
const PDF_PATH = "./sample-docs/invoice.png"; // Hardcoded PDF path
const OUTPUT_JSON = path.join(__dirname, "extracted.json");
const OUTPUT_HTML = path.join(__dirname, "view.html");

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Extraction prompt (EXACT as specified)
const EXTRACTION_PROMPT = `You are a logistics document extraction engine for CargoWise integration.

GOAL
Extract a CargoWise-ready JSON AND verify, for each image/page provided in this batch, whether it contains the most important key fields. Some fields may appear only on certain pages (e.g., totals on the cost breakdown page, shipper/consignee on the last page, line items across many pages).

CRITICAL RULES
- Do NOT guess/infer values not explicitly present.
- Preserve exact spelling/casing/punctuation from the document.
- Return ONLY valid JSON (no markdown, no commentary).
- If a value is not present in the entire document, output null and add it to missing_fields[].
- If a field appears on multiple pages, keep the primary value once in extracted_data, but mark page presence for all pages where seen.

PAGE INDEXING
- The first image in the input batch is page_index = 1, second is 2, etc.
- You MUST produce per_page_presence[] entries for every page in the batch.

MUST-EXTRACT FIELDS (for CargoWise)
Shipment Matching:
- invoice_number
- invoice_date
- bl_number_raw (or hbl_number/mbl_number if present)
- shipper.name, shipper.address
- consignee.name, consignee.address
- port_of_loading
- port_of_destination or port_of_discharge
- vessel_name (and voyage_number if present)
- incoterm (trade term)

Costing/Compliance:
- currency
- invoice_total
- fob_value
- freight
- insurance
- shipping_marks
- country_of_origin
- total_cartons (or package_count/package_type if present)

Line Items:
- Extract all line items one-by-one in document order, across all pages.
- For each line: description, quantity.value+unit, unit_price.value+currency, line_amount.value+currency, po_number, reference_no/item_code, plus color/size if present.

OUTPUT JSON SCHEMA (STRICT)
{
  "document_type": null,
  "batch_summary": {
    "page_count": null,
    "pages_with_header_keys": [],
    "pages_with_totals": [],
    "pages_with_parties": [],
    "pages_with_line_items": [],
    "pages_with_cost_breakdown": []
  },
  "per_page_presence": [
    {
      "page_index": null,
      "detected_sections": {
        "has_invoice_header": false,
        "has_parties_block": false,
        "has_routing_block": false,
        "has_line_items_table": false,
        "has_totals_section": false,
        "has_cost_breakdown": false
      },
      "key_fields_found": {
        "invoice_number": null,
        "invoice_date": null,
        "bl_number_raw": null,
        "vessel_name": null,
        "voyage_number": null,
        "port_of_loading": null,
        "port_of_destination": null,
        "incoterm": null,
        "currency": null,
        "invoice_total": null,
        "fob_value": null,
        "freight": null,
        "insurance": null,
        "shipper_name": null,
        "consignee_name": null,
        "shipping_marks": null,
        "country_of_origin": null,
        "total_cartons": null
      }
    }
  ],
  "extracted_data": {
    "shipment_keys": {
      "mbl_number": null,
      "hbl_number": null,
      "bl_number_raw": null,
      "invoice_number": null,
      "invoice_date": null,
      "payment_terms": null,
      "incoterm": null,
      "mode": null
    },
    "routing": {
      "vessel_name": null,
      "voyage_number": null,
      "port_of_loading": null,
      "port_of_discharge": null,
      "port_of_destination": null,
      "place_of_receipt": null,
      "place_of_delivery": null,
      "etd": null,
      "eta": null
    },
    "parties": {
      "shipper": { "name": null, "address": null, "phone": null, "email": null },
      "consignee": { "name": null, "address": null, "phone": null, "email": null },
      "notify_party": { "name": null, "address": null, "phone": null, "email": null }
    },
    "cargo": {
      "goods_description": null,
      "shipping_marks": null,
      "country_of_origin": null,
      "package_count": null,
      "package_type": null,
      "total_cartons": null,
      "gross_weight": { "value": null, "unit": null },
      "net_weight": { "value": null, "unit": null },
      "volume": { "value": null, "unit": null }
    },
    "financials": {
      "currency": null,
      "invoice_total": null,
      "fob_value": null,
      "freight": null,
      "insurance": null,
      "other_charges": []
    },
    "line_items": [
      {
        "line_no": null,
        "item_code": null,
        "reference_no": null,
        "po_number": null,
        "description": null,
        "color": null,
        "size": null,
        "quantity": { "value": null, "unit": null },
        "unit_price": { "value": null, "currency": null },
        "line_amount": { "value": null, "currency": null },
        "source_page_index": null
      }
    ]
  },
  "missing_fields": [],
  "extraction_confidence": {
    "overall": null,
    "header": null,
    "parties": null,
    "routing": null,
    "financials": null,
    "line_items": null
  }
}

IMPORTANT
- Fill per_page_presence for EVERY page in the batch.
- Set batch_summary arrays based on detected sections per page.
- In line_items, include source_page_index for each item.
- Return JSON only.`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Read PDF file and convert to base64
 * @param {string} pdfPath - Path to PDF file
 * @returns {string} Base64 encoded PDF
 */
function pdfToBase64(pdfPath) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  return pdfBuffer.toString('base64');
}

/**
 * Extract data from PDF using OpenAI Vision (direct PDF support)
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<Object>} Extracted structured data
 */
async function extractDataWithOpenAI(pdfPath) {
  console.log(`\n🤖 Sending PDF directly to OpenAI Vision API...`);

  // Read PDF and convert to base64
  const base64Pdf = pdfToBase64(pdfPath);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Using gpt-4o-mini (vision-capable, supports PDF)
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64Pdf}`
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000
    });

    const outputText = response.choices[0].message.content;
    console.log('✅ Received response from OpenAI');

    // Parse JSON from response
    const extractedData = JSON.parse(outputText);
    return extractedData;
  } catch (error) {
    console.error('❌ Error calling OpenAI API:', error);
    throw error;
  }
}

/**
 * Print summary to console
 * @param {Object} data - Extracted data
 */
function printSummary(data) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Document Type: ${data.document_type || 'N/A'}`);
  
  const keys = data.shipment_keys || {};
  console.log(`BL Number: ${keys.bl_number_raw || keys.hbl_number || keys.mbl_number || 'N/A'}`);
  console.log(`Invoice Number: ${keys.invoice_number || 'N/A'}`);
  
  const routing = data.routing || {};
  console.log(`Port of Loading: ${routing.port_of_loading || 'N/A'}`);
  console.log(`Port of Discharge: ${routing.port_of_discharge || 'N/A'}`);
  
  const financials = data.financials || {};
  console.log(`Invoice Total: ${financials.currency || ''} ${financials.invoice_total || 'N/A'}`);
  
  const lineItems = data.line_items || [];
  console.log(`Number of Line Items: ${lineItems.length}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Generate HTML view from extracted data
 * @param {Object} data - Extracted data
 * @returns {string} HTML content
 */
function generateHTML(data) {
  const lineItems = data.line_items || [];
  
  // Generate line items table rows
  const lineItemsRows = lineItems.map(item => {
    const qty = item.quantity || {};
    const unitPrice = item.unit_price || {};
    const lineAmount = item.line_amount || {};
    
    return `
      <tr>
        <td>${item.line_no ?? ''}</td>
        <td>${item.item_code ?? ''}</td>
        <td>${item.reference_no ?? ''}</td>
        <td>${item.po_number ?? ''}</td>
        <td>${item.description ?? ''}</td>
        <td>${item.color ?? ''}</td>
        <td>${item.size ?? ''}</td>
        <td>${qty.value ?? ''} ${qty.unit ?? ''}</td>
        <td>${unitPrice.currency ?? ''} ${unitPrice.value ?? ''}</td>
        <td>${lineAmount.currency ?? ''} ${lineAmount.value ?? ''}</td>
      </tr>
    `;
  }).join('');

  const missingFields = data.missing_fields || [];
  const missingFieldsList = missingFields.length > 0
    ? `<ul>${missingFields.map(field => `<li>${field}</li>`).join('')}</ul>`
    : '<p>None</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shipping Document Extraction Results</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2c3e50;
      margin-bottom: 30px;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.3em;
    }
    .section {
      margin-bottom: 30px;
      padding: 20px;
      background: #fafafa;
      border-radius: 5px;
      border-left: 4px solid #3498db;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .info-item {
      padding: 10px;
      background: white;
      border-radius: 4px;
    }
    .info-label {
      font-weight: bold;
      color: #7f8c8d;
      font-size: 0.9em;
      margin-bottom: 5px;
    }
    .info-value {
      color: #2c3e50;
      font-size: 1.1em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      background: white;
      font-size: 0.9em;
    }
    th {
      background: #3498db;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #e0e0e0;
    }
    tr:hover {
      background: #f8f9fa;
    }
    .missing-fields {
      background: #fff3cd;
      border-left-color: #ffc107;
    }
    .missing-fields ul {
      margin-left: 20px;
      margin-top: 10px;
    }
    .missing-fields li {
      margin-bottom: 5px;
    }
    .json-section {
      margin-top: 30px;
    }
    .json-toggle {
      background: #6c757d;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
      margin-bottom: 10px;
    }
    .json-toggle:hover {
      background: #5a6268;
    }
    .json-content {
      display: none;
      background: #2c3e50;
      color: #ecf0f1;
      padding: 20px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      line-height: 1.5;
    }
    .json-content.show {
      display: block;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📄 Shipping Document Extraction Results</h1>

    <!-- Document Type & Keys -->
    <div class="section">
      <h2>Document Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Document Type</div>
          <div class="info-value">${data.document_type || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">MBL Number</div>
          <div class="info-value">${data.shipment_keys?.mbl_number || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">HBL Number</div>
          <div class="info-value">${data.shipment_keys?.hbl_number || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">BL Number (Raw)</div>
          <div class="info-value">${data.shipment_keys?.bl_number_raw || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Invoice Number</div>
          <div class="info-value">${data.shipment_keys?.invoice_number || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Invoice Date</div>
          <div class="info-value">${data.shipment_keys?.invoice_date || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Payment Terms</div>
          <div class="info-value">${data.shipment_keys?.payment_terms || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Incoterm</div>
          <div class="info-value">${data.shipment_keys?.incoterm || 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Routing -->
    <div class="section">
      <h2>Routing Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Vessel Name</div>
          <div class="info-value">${data.routing?.vessel_name || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Voyage Number</div>
          <div class="info-value">${data.routing?.voyage_number || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Port of Loading</div>
          <div class="info-value">${data.routing?.port_of_loading || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Port of Discharge</div>
          <div class="info-value">${data.routing?.port_of_discharge || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Port of Destination</div>
          <div class="info-value">${data.routing?.port_of_destination || 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Parties -->
    <div class="section">
      <h2>Parties</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Shipper</div>
          <div class="info-value">${data.parties?.shipper?.name || 'N/A'}</div>
          <div style="font-size: 0.85em; color: #7f8c8d; margin-top: 5px;">${data.parties?.shipper?.address || ''}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Consignee</div>
          <div class="info-value">${data.parties?.consignee?.name || 'N/A'}</div>
          <div style="font-size: 0.85em; color: #7f8c8d; margin-top: 5px;">${data.parties?.consignee?.address || ''}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Notify Party</div>
          <div class="info-value">${data.parties?.notify_party?.name || 'N/A'}</div>
          <div style="font-size: 0.85em; color: #7f8c8d; margin-top: 5px;">${data.parties?.notify_party?.address || ''}</div>
        </div>
      </div>
    </div>

    <!-- Financials -->
    <div class="section">
      <h2>Financial Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Currency</div>
          <div class="info-value">${data.financials?.currency || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Invoice Total</div>
          <div class="info-value">${data.financials?.currency || ''} ${data.financials?.invoice_total || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">FOB Value</div>
          <div class="info-value">${data.financials?.currency || ''} ${data.financials?.fob_value || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Freight</div>
          <div class="info-value">${data.financials?.currency || ''} ${data.financials?.freight || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Insurance</div>
          <div class="info-value">${data.financials?.currency || ''} ${data.financials?.insurance || 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Cargo -->
    <div class="section">
      <h2>Cargo Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Goods Description</div>
          <div class="info-value">${data.cargo?.goods_description || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Shipping Marks</div>
          <div class="info-value">${data.cargo?.shipping_marks || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Country of Origin</div>
          <div class="info-value">${data.cargo?.country_of_origin || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Total Cartons</div>
          <div class="info-value">${data.cargo?.total_cartons || 'N/A'}</div>
        </div>
      </div>
    </div>

    <!-- Line Items -->
    <div class="section">
      <h2>Line Items (${lineItems.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Line No</th>
            <th>Item Code</th>
            <th>Reference No</th>
            <th>PO Number</th>
            <th>Description</th>
            <th>Color</th>
            <th>Size</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Line Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsRows || '<tr><td colspan="10">No line items found</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Missing Fields -->
    <div class="section missing-fields">
      <h2>Missing Fields</h2>
      ${missingFieldsList}
    </div>

    <!-- Raw JSON -->
    <div class="section json-section">
      <h2>Raw JSON Data</h2>
      <button class="json-toggle" onclick="toggleJSON()">Show/Hide JSON</button>
      <div class="json-content" id="jsonContent">
        <pre>${JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  </div>

  <script>
    function toggleJSON() {
      const content = document.getElementById('jsonContent');
      content.classList.toggle('show');
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  try {
    console.log('🚀 Starting Shipping Document Extraction Demo\n');

    // Check if PDF exists
    const pdfFullPath = path.resolve(__dirname, PDF_PATH);
    if (!fs.existsSync(pdfFullPath)) {
      console.error(`❌ PDF file not found: ${pdfFullPath}`);
      console.log('💡 Please ensure the PDF file exists at the specified path.');
      process.exit(1);
    }

    console.log(`📄 Processing PDF: ${pdfFullPath}`);

    // Extract data directly from PDF using OpenAI Vision
    const extractedData = await extractDataWithOpenAI(pdfFullPath);

    // Print summary to console
    printSummary(extractedData);

    // Write JSON to file
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(extractedData, null, 2));
    console.log(`✅ Extracted data saved to: ${OUTPUT_JSON}`);

    // Generate HTML view
    const htmlContent = generateHTML(extractedData);
    fs.writeFileSync(OUTPUT_HTML, htmlContent);
    console.log(`✅ HTML view generated: ${OUTPUT_HTML}`);
    console.log(`\n🌐 Open ${OUTPUT_HTML} in your browser to view the results!\n`);

    console.log('✅ Extraction complete!');

  } catch (error) {
    console.error('\n❌ Error during extraction:', error);
    process.exit(1);
  }
}

// Run the main function
main();

