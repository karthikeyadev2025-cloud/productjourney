// lib/gemini.js — Gemini API client (text + image generation)

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export function mimeForFile(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXT[ext] || 'image/jpeg';
}

async function callGemini(model, apiKey, body, attempt = 1) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 3) {
      await new Promise(r => setTimeout(r, attempt * 4000));
      return callGemini(model, apiKey, body, attempt + 1);
    }
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error (HTTP ${res.status})`);
  return data;
}

export async function generateDescription(apiKey, textModel, imageBase64, mimeType) {
  const prompt = `You are a luxury jewelry copywriter for a high-end Indian e-commerce brand.
Study this jewelry product photo carefully and return ONLY a JSON object (no markdown, no backticks) with exactly these keys:

{
  "product_name": "A short elegant product name, 2-4 words, unique and specific to this piece",
  "category": "One of: necklace, earrings, ring, bangle, bracelet, pendant, nose-pin, anklet, mangalsutra, other",
  "short_description": "One luxury hook sentence, max 25 words",
  "long_description": "A 3-4 sentence design story: craftsmanship, inspiration, occasion, feel. End with 'Materials: [METAL] | [STONE/S] | [PURITY] | [WEIGHT]'",
  "materials": "[METAL] | [STONE/S] | [PURITY] | [WEIGHT]",
  "tags": ["3-6 short keyword tags relevant to the piece"]
}

Base everything on what is visible. Never invent karat, weight, purity or certification — always keep those as the bracketed placeholders.`;

  const data = await callGemini(textModel, apiKey, {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.8 }
  });

  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  if (!parsed.product_name) throw new Error('Model did not return a product name');
  return parsed;
}

/**
 * Generate one scene variant. Jewelry stays identical; only scene changes.
 * Accepts a fully-composed scenePrompt (already interpolated with model + angle).
 */
export async function generateVariant(apiKey, imageModel, imageBase64, mimeType, scenePrompt) {
  const fullPrompt = `CRITICAL RULE: This is a product inpainting task. The jewelry piece in the provided photo must remain 100% IDENTICAL — exact same shape, design, stones, stone count, metal color, engravings, proportions and reflections. Do NOT redesign, alter, add or remove any part of the jewelry itself. Only replace the environment/background/scene around it.

SCENE: ${scenePrompt}

Output a photorealistic, high-resolution, professional e-commerce photograph. Sharp focus on the jewelry, natural shadows, luxury commercial quality.`;

  const data = await callGemini(imageModel, apiKey, {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: fullPrompt }
      ]
    }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
  });

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.data || p.inline_data?.data);
  if (!imgPart) {
    const refusal = parts.map(p => p.text || '').join(' ').trim();
    throw new Error(refusal ? `No image returned: ${refusal.slice(0, 200)}` : 'No image returned by model');
  }
  const b64 = imgPart.inlineData?.data || imgPart.inline_data?.data;
  return Buffer.from(b64, 'base64');
}

export async function testKey(apiKey, textModel) {
  const data = await callGemini(textModel, apiKey, {
    contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }]
  });
  return Boolean(data?.candidates?.length);
}
