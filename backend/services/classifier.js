const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const DOCUMENT_TYPES = {
  AADHAAR:         { folder: 'Identity/Aadhaar',           label: 'Aadhaar Card' },
  PAN:             { folder: 'Identity/PAN Card',           label: 'PAN Card' },
  PASSPORT:        { folder: 'Identity/Passport',           label: 'Passport' },
  DRIVING_LICENSE: { folder: 'Identity/Driving License',    label: 'Driving License' },
  VOTER_ID:        { folder: 'Identity/Voter ID',           label: 'Voter ID' },
  MARKSHEET:       { folder: 'Education/Marksheets',        label: 'Marksheet' },
  DEGREE:          { folder: 'Education/Degrees',           label: 'Degree Certificate' },
  RESUME:          { folder: 'Career/Resumes',              label: 'Resume/CV' },
  OFFER_LETTER:    { folder: 'Career/Offer Letters',        label: 'Offer Letter' },
  PAYSLIP:         { folder: 'Finance/Payslips',            label: 'Payslip' },
  BANK_STATEMENT:  { folder: 'Finance/Bank Statements',     label: 'Bank Statement' },
  TAX_FORM:        { folder: 'Finance/Tax Documents',       label: 'Tax Form' },
  INSURANCE:       { folder: 'Finance/Insurance',           label: 'Insurance Document' },
  MEDICAL:         { folder: 'Medical/Reports',             label: 'Medical Report' },
  PRESCRIPTION:    { folder: 'Medical/Prescriptions',       label: 'Prescription' },
  PROPERTY:        { folder: 'Property/Documents',          label: 'Property Document' },
  UTILITY_BILL:    { folder: 'Bills/Utility',               label: 'Utility Bill' },
  OTHER:           { folder: 'Other',                       label: 'Other Document' },
};

async function classifyDocument(filePath, mimeType, fileName) {
  // ── Validate API key first ─────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set in .env — classification skipped, defaulting to Other');
    return fallback(fileName, 'ANTHROPIC_API_KEY missing in .env');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    let messageContent = [];

    if (mimeType.startsWith('image/')) {
      // ── Vision path ──────────────────────────────────────────────────────────
      const imageData = fs.readFileSync(filePath);
      const base64Image = imageData.toString('base64');

      // Normalise HEIC → jpeg for the API (Anthropic doesn't accept image/heic)
      const apiMimeType = mimeType === 'image/heic' ? 'image/jpeg' : mimeType;

      messageContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: apiMimeType, data: base64Image },
        },
        { type: 'text', text: buildPrompt(fileName) },
      ];
    } else {
      // ── Text/filename path (PDFs without extraction) ──────────────────────
      messageContent = [
        {
          type: 'text',
          text: `Document filename: "${fileName}"\nMIME type: ${mimeType}\n\n${buildPrompt(fileName)}`,
        },
      ];
    }

    console.log(`   🧠 Calling Claude (claude-sonnet-4-5) for classification…`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',          // ← correct current model string
      max_tokens: 400,
      messages: [{ role: 'user', content: messageContent }],
    });

    const rawText = response.content[0]?.text?.trim() || '';
    console.log(`   📋 Claude raw response: ${rawText.slice(0, 200)}`);

    const result = parseResponse(rawText, fileName);
    console.log(`   ✅ Classified: ${result.type} → folder: "${result.folder}" (confidence: ${result.confidence})`);
    return result;

  } catch (err) {
    // Log the FULL error so it shows in terminal — no silent swallowing
    console.error(`\n❌ Classification error: ${err.message}`);
    if (err.status) console.error(`   HTTP status: ${err.status}`);
    if (err.error)  console.error(`   API error:`, JSON.stringify(err.error));
    console.error(`   Falling back to OTHER folder\n`);
    return fallback(fileName, err.message);
  }
}

function buildPrompt(fileName) {
  const typeKeys = Object.keys(DOCUMENT_TYPES).join(', ');
  return `You are a document classifier. Analyze this document and return ONLY a JSON object — no markdown, no explanation, no backticks.

Classify into one of these exact types: ${typeKeys}

Return this exact JSON structure:
{
  "type": "AADHAAR",
  "confidence": "high",
  "extractedInfo": {
    "name": "person name if visible or null",
    "documentNumber": "ID number if visible or null",
    "dateOfBirth": "DD/MM/YYYY if visible or null",
    "issueDate": "issue date if visible or null",
    "expiryDate": "expiry date if visible or null",
    "organization": "issuing organization if visible or null",
    "year": "relevant year if visible or null"
  },
  "suggestedName": "PersonName_DocumentType_Year.ext"
}

Rules:
- type MUST be one of the exact strings listed above
- confidence is "high", "medium", or "low"
- suggestedName: CamelCase, no spaces, keep original extension (e.g. RaviKumar_Aadhaar_2024.jpg)
- If nothing is identifiable, use type "OTHER"
- Original filename for context: "${fileName}"`;
}

function parseResponse(rawText, fileName) {
  try {
    const clean = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/,      '')
      .replace(/```\s*$/,      '')
      .trim();

    const parsed = JSON.parse(clean);

    // Validate the type is one we know
    const typeKey = parsed.type && DOCUMENT_TYPES[parsed.type]
      ? parsed.type
      : 'OTHER';

    if (!DOCUMENT_TYPES[parsed.type]) {
      console.warn(`   ⚠️  Claude returned unknown type "${parsed.type}" — using OTHER`);
    }

    return {
      type:          typeKey,
      folder:        DOCUMENT_TYPES[typeKey].folder,
      label:         DOCUMENT_TYPES[typeKey].label,
      extractedInfo: parsed.extractedInfo || {},
      suggestedName: parsed.suggestedName || fileName,
      confidence:    parsed.confidence || 'medium',
    };
  } catch (parseErr) {
    console.error(`   ⚠️  Failed to parse Claude response as JSON: ${parseErr.message}`);
    console.error(`   Raw text was: "${rawText.slice(0, 300)}"`);
    return fallback(fileName, 'JSON parse failed');
  }
}

function fallback(fileName, reason) {
  return {
    type:          'OTHER',
    folder:        DOCUMENT_TYPES.OTHER.folder,
    label:         DOCUMENT_TYPES.OTHER.label,
    extractedInfo: {},
    suggestedName: fileName,
    confidence:    'low',
    fallbackReason: reason,
  };
}

module.exports = { classifyDocument, DOCUMENT_TYPES };
