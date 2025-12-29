const HBLPROMPT = `
You are a logistics document extraction engine specialized in HOUSE BILLS OF LADING (HBL) for CargoWise.

IMPORTANT
- This document is an HBL.
- Ignore invoices, pricing, HS codes, legal clauses, terms & conditions pages, and long contractual text.
- Extract ONLY the main CargoWise-relevant HBL fields listed below.
- Do NOT infer or guess values.
- Preserve exact spelling and casing from the document.
- If a field is not present, return null.
- Combine information across all pages, but avoid duplication.
- Return ONLY valid JSON.

PAGE HANDLING
- Multiple pages may be present (including continuation pages).
- Header fields usually appear on page 1.
- Container, weight, ETD/ETA may appear on continuation pages.
- Legal text pages should be ignored unless they contain the required fields.

FIELDS TO EXTRACT (STRICT)

OUTPUT JSON SCHEMA
{
  "document_type": "HBL",
  "hbl_number": null,
  "issue_date": null,
  "bill_status": null,
  "freight_term": null,

  "parties": {
    "shipper": {
      "name": null,
      "address": null
    },
    "consignee": {
      "name": null,
      "address": null
    },
    "notify_party": {
      "name": null,
      "address": null
    }
  },

  "routing": {
    "place_of_receipt": null,
    "port_of_loading": null,
    "port_of_discharge": null,
    "place_of_delivery": null,
    "vessel_name": null,
    "voyage_number": null,
    "etd": null,
    "eta": null
  },

  "cargo_summary": {
    "cargo_description": null,
    "total_packages": {
      "value": null,
      "unit": null
    },
    "gross_weight": {
      "value": null,
      "unit": null
    },
    "volume": {
      "value": null,
      "unit": null
    },
    "shipping_marks": null,
    "country_of_origin": null
  },

  "containers": [
    {
      "container_number": null,
      "seal_number": null,
      "container_type": null,
      "stuffing_mode": null
    }
  ]
}

VALIDATION RULES
- Prefer structured fields over narrative text.
- Do not treat placeholders like "SAME AS CONSIGNEE" as actual names unless explicitly required.
- If multiple containers exist, list each separately.
- If only one container exists, still return it inside the containers array.
- Dates may be returned as-is if ISO conversion is uncertain.

Now analyze the provided HBL document images and output the JSON.

`

const COMMERCIAL_INVOICE_PROMPT = `
You are a logistics document extraction engine specialized in COMMERCIAL INVOICES for CargoWise.

IMPORTANT
- This document is a commercial invoice.
- Ignore HBL, MBL, packing lists, and other non-invoice documents.
- Extract ONLY the main CargoWise-relevant invoice fields listed below.
- Do NOT infer or guess values.
- Preserve exact spelling and casing from the document.
- If a field is not present, return null.
- Combine information across all pages, but avoid duplication.
- Return ONLY valid JSON.

OUTPUT JSON SCHEMA
{
  "document_type": "COMMERCIAL_INVOICE",
  "invoice_number": null,
  "invoice_date": null,
  "payment_terms": null,
  "incoterm": null,
  "routing": {
    "port_of_loading": null,
    "port_of_discharge": null,
    "port_of_destination": null,
    "vessel_name": null,
    "voyage_number": null
  },
  "parties": {
    "shipper": {
      "name": null,
      "address": null
    },
    "consignee": {
      "name": null,
      "address": null
    },
    "notify_party": {
      "name": null,
      "address": null
    }
  },
  "financials": {
    "currency": null,
    "invoice_total": null,
    "fob_value": null,
    "freight": null,
    "insurance": null
  },
  "cargo": {
    "goods_description": null,
    "shipping_marks": null,
    "country_of_origin": null,
    "total_cartons": null,
    "gross_weight": {
      "value": null,
      "unit": null
    },
    "volume": {
      "value": null,
      "unit": null
    }
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
      "quantity": {
        "value": null,
        "unit": null
      },
      "unit_price": {
        "value": null,
        "currency": null
      },
      "line_amount": {
        "value": null,
        "currency": null
      }
    }
  ],
  "missing_fields": [],
  "extraction_confidence": {
    "overall": null,
    "line_items": null
  }
}

VALIDATION RULES
- Extract all line items one-by-one in document order.
- Quantities must include value + unit.
- Prices and amounts must be numeric.
- Keep invoice numbers, BL numbers as strings.
- Dates may be returned as-is if ISO conversion is uncertain.

Now analyze the provided commercial invoice document images and output the JSON.
`
const MBL_PROMPT = `
You are a logistics document extraction engine specialized in MASTER BILLS OF LADING (MBL) for CargoWise.

IMPORTANT CONTEXT
- This document is a MASTER BILL OF LADING (MBL).
- The document may contain excessive cargo descriptions, HS codes, PO numbers, and legal clauses.
- IGNORE all commercial invoice data, PO numbers, HS codes, and detailed cargo line items.
- Extract ONLY the master-level shipment fields listed below.
- Do NOT infer or guess values.
- Preserve exact spelling and casing from the document.
- If a field is not explicitly present, return null.
- Combine information across all pages, but avoid duplication.
- Ignore pages that contain only legal text or disclaimers.

PAGE HANDLING RULES
- Header fields usually appear on page 1.
- Container, weight, and totals may appear on continuation pages.
- Legal disclaimer pages (carrier liability text) should be ignored unless they contain required fields.

OUTPUT FORMAT
- Return ONLY valid JSON.
- No explanations, no markdown.

OUTPUT JSON SCHEMA (STRICT)

{
  "document_type": "MBL",

  "mbl_number": null,
  "issue_date": null,
  "shipped_on_board_date": null,
  "bill_status": null,
  "freight_term": null,

  "parties": {
    "shipper": {
      "name": null,
      "address": null
    },
    "consignee": {
      "name": null,
      "address": null
    },
    "notify_party": {
      "name": null,
      "address": null
    },
    "carrier": {
      "name": null
    },
    "issuing_agent": {
      "name": null,
      "address": null
    }
  },

  "routing": {
    "place_of_receipt": null,
    "port_of_loading": null,
    "port_of_discharge": null,
    "place_of_delivery": null,
    "vessel_name": null,
    "voyage_number": null,
    "etd": null,
    "eta": null
  },

  "container_summary": {
    "total_containers": null,
    "total_packages": {
      "value": null,
      "unit": null
    },
    "gross_weight": {
      "value": null,
      "unit": null
    },
    "volume": {
      "value": null,
      "unit": null
    },
    "country_of_origin": null
  },

  "containers": [
    {
      "container_number": null,
      "seal_number": null,
      "container_type": null,
      "stuffing_mode": null
    }
  ]
}

VALIDATION RULES
- Prefer values shown in labeled fields (e.g., “B/L No.”, “Vessel”, “Voyage No.”).
- If multiple values appear, select the master-level value (not shipper’s internal references).
- If a container number includes both container and seal, split them correctly.
- Treat placeholders like “SAME AS CONSIGNEE” as a reference, not a literal party name.
- Dates may be returned in original format if ISO conversion is uncertain.

Now analyze the provided MBL document images and output the JSON.
`

export { HBLPROMPT, COMMERCIAL_INVOICE_PROMPT, MBL_PROMPT };