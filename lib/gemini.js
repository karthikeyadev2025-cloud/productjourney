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
  try {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.error?.message || `Gemini error (HTTP ${res.status})`;
      const isRateLimit = res.status === 429 || res.status === 503 || /quota|limit|exhausted|rate|demand|temporarily|unavailable|overload|busy|capacity/i.test(errMsg);
      
      if (isRateLimit && attempt <= 5) {
        let waitMs = attempt * 20000; // standard fallback backoff (20s, 40s, 60s, 80s, 100s)
        const match = errMsg.match(/retry in ([\d.]+)\s*s/i);
        if (match) {
          waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 1500; // Add 1.5s safety buffer
        }
        console.warn(`[Gemini API] Rate limit hit. Waiting ${waitMs / 1000}s before retry (attempt ${attempt})...`);
        await new Promise(r => setTimeout(r, waitMs));
        return callGemini(model, apiKey, body, attempt + 1);
      }
      throw new Error(errMsg);
    }
    return data;
  } catch (err) {
    const isRateLimit = /quota|limit|exhausted|rate|demand|temporarily|unavailable|overload|busy|capacity/i.test(err.message);
    if (isRateLimit && attempt <= 5) {
      const fallbackWait = attempt * 15000;
      console.warn(`[Gemini API] Network rate error. Waiting ${fallbackWait / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, fallbackWait));
      return callGemini(model, apiKey, body, attempt + 1);
    }
    throw err;
  }
}

function cleanAndParseJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json/i, '').replace(/```$/, '').trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 1. Remove trailing commas
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
    
    // 2. Escape actual newlines inside quote blocks
    cleaned = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
      return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    });

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      // Regex extraction fallback
      const getValue = (key) => {
        const re = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i');
        const match = cleaned.match(re);
        if (match) {
          return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
        return '';
      };
      
      const getArray = (key) => {
        const re = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`, 'i');
        const match = cleaned.match(re);
        if (match) {
          return match[1].split(',')
            .map(s => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
        }
        return [];
      };

      const fallbackObj = {
        product_name: getValue('product_name') || 'Elegant Product Piece',
        category: getValue('category') || 'other',
        short_description: getValue('short_description') || 'A luxury premium product accessory.',
        long_description: getValue('long_description') || 'Expertly designed luxury e-commerce product.',
        materials: getValue('materials') || '[METAL/FABRIC/INGREDIENTS] | [SPECIFICATION] | [WEIGHT/SIZE]',
        tags: getArray('tags')
      };

      if (fallbackObj.product_name && fallbackObj.product_name !== 'Elegant Product Piece') {
        return fallbackObj;
      }
      throw new Error(`Failed to parse AI response: ${err.message}`);
    }
  }
}

export async function generateDescription(apiKey, textModel, imageBase64, mimeType) {
  const prompt = `You are a luxury product copywriter for a high-end e-commerce brand.
Study this product photo carefully and return ONLY a JSON object (no markdown, no backticks) with exactly these keys:

{
  "product_name": "A short elegant product name, 2-4 words, unique and specific to this item",
  "category": "One of: jewelry, cosmetics, bags, footwear, watches, accessories, electronics, home, apparel, other",
  "short_description": "One luxury hook sentence, max 25 words",
  "long_description": "A 3-4 sentence design story: craftsmanship, details, materials, purpose, feel. End with 'Materials: [SPECIFICATION] | [MATERIAL/S] | [WEIGHT/DIMENSIONS]'",
  "materials": "[METAL/FABRIC/INGREDIENTS] | [SPECIFICATION] | [WEIGHT/SIZE]",
  "tags": ["3-6 short keyword tags relevant to the product"]
}

Base everything on what is visible. Never invent materials, weight, purity or certification — always keep those as the bracketed placeholders.`;

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
  const parsed = cleanAndParseJson(text);
  if (!parsed.product_name) throw new Error('Model did not return a product name');
  return parsed;
}

/**
 * Generate one scene variant. Product stays identical; only scene changes.
 * Accepts a fully-composed scenePrompt (already interpolated with model + angle).
 */
export async function generateVariant(apiKey, imageModel, imageBase64, mimeType, scenePrompt, aspectRatio = '1:1') {
  const fullPrompt = `CRITICAL RULE: This is a product inpainting task. The product in the provided photo must remain 100% IDENTICAL — exact same shape, design, branding, logo, colors, material texture, reflections, and proportions. Do NOT redesign, alter, add or remove any part of the product itself. Preserve the metal reflectivity, gemstone brilliance, facet cuts, polish, and product structure exactly. The details must look razor-sharp. Only replace the environment/background/scene around it.

ADDITIONAL TAG REMOVAL RULE: If the original product photo has a price tag, barcode, hanging label, paper string, or plastic attachment connected to it, you MUST REMOVE that tag/label/string completely from the output scene. Do NOT render the tag, paper, or string. Replace the area where the tag/string was with clean skin, clothes, or background matching the scene naturally, while leaving the product itself completely untouched and identical. Do not blur or alter the surrounding clasp or details of the product.

REALISM RULE (APPLIES TO ALL OUTPUTS WITHOUT EXCEPTION):
— If the scene shows the ring worn on a hand or finger: the ring band MUST be fully and physically slid onto the finger, sitting snugly at the base of the finger joint, in full contact with the skin. The finger must pass completely through the ring band. The skin must compress and wrap naturally against the metal exactly as it does on a genuinely worn ring. The ring must NEVER float above, hover beside, or appear detached from the finger in any way.
— If the scene is a still-life (marble, silk, velvet, box, studio): the ring must appear fully three-dimensional and physically present — casting a real, grounded contact shadow on the surface beneath it. It must never look like a cutout, a floating overlay, or a digital composite. The band must rest solidly on the surface with correct perspective and weight.
— In ALL scenes: every element of the output must look indistinguishable from a real studio photograph taken by a professional photographer. No AI artifacts, no transparency glitches, no unrealistic lighting mismatches. The jewelry and its environment must feel physically connected and photographically real.

SCENE: ${scenePrompt}

Output format: ${aspectRatio} aspect ratio.
Output a photorealistic, ultra-high-resolution, professional e-commerce campaign photograph. Captured using a high-end medium format camera (like Hasselblad), professional catalog studio lighting, soft natural contact shadows, rich textures, and perfect white balance.`;

  const data = await callGemini(imageModel, apiKey, {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: fullPrompt }
      ]
    }],
    generationConfig: { 
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: aspectRatio
      }
    }
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
