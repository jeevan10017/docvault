/**
 * Optional AI naming via Anthropic API.
 *
 * - Completely optional: set REACT_APP_ANTHROPIC_KEY in frontend/.env
 * - If key is missing, empty, or the call fails for ANY reason → returns null
 * - Caller must always have a fallback (sequential name)
 * - Never throws — always returns null on failure
 *
 * The API call is made from the FRONTEND directly to Anthropic.
 * This avoids needing a backend route and keeps it self-contained.
 *
 * Usage:
 *   const aiName = await suggestName(file, folderPath);
 *   const finalName = aiName || getSequentialName(folderPath, ext);
 */

export async function suggestName(file, folderPath) {
  const key = process.env.REACT_APP_ANTHROPIC_KEY;
  if (!key) return null; // AI disabled — not an error

  try {
    // For images: send as base64. For PDFs: just send filename + folder.
    const isImage = file.type.startsWith('image/');
    let messages;

    if (isImage && file.size < 4 * 1024 * 1024) { // only if under 4MB
      const base64 = await fileToBase64(file);
      const mimeType = file.type === 'image/heic' ? 'image/jpeg' : file.type;
      messages = [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: buildPrompt(file.name, folderPath) },
        ],
      }];
    } else {
      messages = [{
        role: 'user',
        content: buildPrompt(file.name, folderPath),
      }];
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // cheapest/fastest model
        max_tokens: 60,
        messages,
      }),
    });

    if (!res.ok) {
      console.warn(`[AI naming] API returned ${res.status} — using sequential name`);
      return null;
    }

    const data  = await res.json();
    const text  = data?.content?.[0]?.text?.trim() || '';
    const clean = text.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();

    if (!clean || clean.length < 3 || clean.length > 80) return null;

    // Strip any extension the model added — we'll add the correct one later
    return clean.replace(/\.[a-zA-Z0-9]+$/, '');

  } catch (err) {
    console.warn('[AI naming] Failed:', err.message, '— using sequential name');
    return null;
  }
}

function buildPrompt(filename, folderPath) {
  return `You are a document file-naming assistant.
Suggest a short, descriptive filename (NO extension, NO path, NO quotes) for a document.
Folder it will be saved in: "${folderPath || 'General'}"
Original filename: "${filename}"

Rules:
- 2-5 words max, CamelCase, no spaces
- Use context from folder name if filename is generic (e.g. IMG_1234)
- If a person's name is visible, include it: "RaviKumar_Aadhaar"
- If it's a date-based doc, include year: "Payslip_March2024"
- If filename is already descriptive, improve it slightly
- Return ONLY the filename, nothing else

Examples:
- folder=Finance/Payslips, file=IMG_001.jpg → "Payslip_Jan2024"
- folder=Identity/Aadhaar, file=scan.jpg → "AadhaarCard"
- folder=Career/Resumes, file=resume_v2.pdf → "Resume_Updated"`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
