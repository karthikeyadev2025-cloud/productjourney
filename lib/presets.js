// lib/presets.js — reusable creative controls

// lib/presets.js — reusable creative controls

export function determineProductType(product) {
  if (!product) return 'other';
  const name = (product.product_name || '').toLowerCase();
  const desc = (product.long_description || '').toLowerCase();
  const tags = (product.tags || []).map(t => t.toLowerCase());

  // Check tags first
  if (tags.includes('earrings') || tags.includes('earring')) return 'earrings';
  if (tags.includes('ring') || tags.includes('rings')) return 'ring';
  if (tags.includes('necklace') || tags.includes('pendant') || tags.includes('necklaces') || tags.includes('pendants') || tags.includes('chain')) return 'necklace';
  if (tags.includes('bangle') || tags.includes('bangles') || tags.includes('bracelet') || tags.includes('bracelets') || tags.includes('cuff')) return 'bracelet';
  if (tags.includes('set') || tags.includes('jewelry set') || tags.includes('sets')) return 'set';

  // Check product name
  if (/\bearrings?\b/i.test(name)) return 'earrings';
  if (/\bring\b|\brings\b/i.test(name)) return 'ring';
  if (/\bnecklace\b|\bpendant\b|\bchain\b/i.test(name)) return 'necklace';
  if (/\bbracelet\b|\bbangle\b|\bcuff\b/i.test(name)) return 'bracelet';
  if (/\bset\b/i.test(name)) return 'set';

  // Check long description
  if (/\bearrings?\b/i.test(desc)) return 'earrings';
  if (/\bring\b|\brings\b/i.test(desc)) return 'ring';
  if (/\bnecklace\b|\bpendant\b|\bchain\b/i.test(desc)) return 'necklace';
  if (/\bbracelet\b|\bbangle\b|\bcuff\b/i.test(desc)) return 'bracelet';
  if (/\bset\b/i.test(desc)) return 'set';

  return 'other';
}

export const SCENES = [
  { key: 'copy_only', label: 'Copywriting Only (No Renders)', prompt: 'NONE', needsModel: false },
  {
    key: 'marble',
    label: 'Marble luxury',
    needsModel: false,
    prompt: 'The ring is placed upright resting on its band on a luxury white-and-grey Calacatta marble surface, showing the gemstone facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the ring band, minimal premium catalog look. The ring must appear three-dimensional and solid, not floating.',
    prompts: {
      ring: 'The ring is placed upright resting on its band on a luxury white-and-grey Calacatta marble surface, showing the gemstone facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the ring band, minimal premium catalog look. The ring must appear three-dimensional and solid, not floating.',
      earrings: 'The earrings are placed elegantly on a luxury white-and-grey Calacatta marble surface, showing the design and gemstones facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the earrings, minimal premium catalog look. The earrings must appear three-dimensional and solid, not floating.',
      necklace: 'The necklace is laid out elegantly on a luxury white-and-grey Calacatta marble surface, showing the pendant and chain facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the necklace, minimal premium catalog look. The necklace must appear three-dimensional and solid, not floating.',
      bracelet: 'The bracelet is placed elegantly on a luxury white-and-grey Calacatta marble surface, showing the metalwork and gemstones, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the bracelet, minimal premium catalog look. The bracelet must appear three-dimensional and solid, not floating.',
      set: 'The jewelry set is placed elegantly on a luxury white-and-grey Calacatta marble surface, showing the matching necklace and earrings facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the jewelry, minimal premium catalog look. The jewelry must appear three-dimensional and solid, not floating.',
      other: 'The product is placed elegantly on a luxury white-and-grey Calacatta marble surface, showing its main details facing the camera, soft diffused jewelry studio lighting, clean soft ambient shadows beneath it, minimal premium catalog look. The product must appear three-dimensional and solid, not floating.'
    }
  },
  {
    key: 'model',
    label: 'Model editorial',
    needsModel: true,
    prompt: "The ring is naturally and properly worn on the ring finger of {MODEL} — the band is fully slid onto the finger, sitting snugly at the base of the finger joint, exactly as a ring would be worn in real life. Close-up editorial fashion photograph of the hand and ring, flawless skin, soft ambient lighting, high-end jewelry commercial style. The ring must look physically realistic — properly fitted on the finger, not floating, not held, not beside the finger.",
    prompts: {
      ring: "The ring is naturally and properly worn on the ring finger of {MODEL} — the band is fully slid onto the finger, sitting snugly at the base of the finger joint, exactly as a ring would be worn in real life. Close-up editorial fashion photograph of the hand and ring, flawless skin, soft ambient lighting, high-end jewelry commercial style. The ring must look physically realistic — properly fitted on the finger, not floating, not held, not beside the finger.",
      earrings: "The earrings are naturally and properly worn on the earlobes of {MODEL} — hanging elegantly, exactly as earrings would be worn in real life. Close-up editorial fashion photograph of the model's side profile, ear, and cheek, showing the earrings beautifully, flawless skin, soft ambient lighting, high-end jewelry commercial style. The earrings must look physically realistic — properly hanging from the ears, not floating, not beside the ears.",
      necklace: "The necklace is naturally and properly worn around the neck of {MODEL} — resting elegantly on the collarbone, exactly as a necklace would be worn in real life. Close-up editorial fashion photograph of the model's neckline and collarbone showing the pendant and chain, flawless skin, soft ambient lighting, high-end jewelry commercial style. The necklace must look physically realistic — properly resting on the skin, not floating, not beside the neck.",
      bracelet: "The bracelet is naturally and properly worn around the wrist of {MODEL} — resting snugly against the skin, exactly as a bracelet would be worn in real life. Close-up editorial fashion photograph of the model's wrist and hand, flawless skin, soft ambient lighting, high-end jewelry commercial style. The bracelet must look physically realistic — properly wrapped around the wrist, not floating, not beside the wrist.",
      set: "The matching jewelry set (necklace and earrings) is naturally and properly worn by {MODEL} — the earrings hanging from the earlobes and the necklace resting on the collarbone, exactly as worn in real life. Close-up editorial fashion photograph of the model's face and neckline, flawless skin, soft ambient lighting, high-end jewelry commercial style. The jewelry must look physically realistic — properly worn, not floating, not beside the body.",
      other: "The jewelry product is naturally and properly worn on {MODEL}, exactly as it would be worn in real life. Close-up editorial fashion photograph, flawless skin, soft ambient lighting, high-end jewelry commercial style. The product must look physically realistic — properly fitted, not floating, not beside the model."
    }
  },
  {
    key: 'golden',
    label: 'Golden hour',
    needsModel: true,
    prompt: "The ring is naturally worn on the ring finger of {MODEL} outdoors during golden hour — the band is fully slid onto the finger, fitting snugly and realistically as a worn ring. The hand is elegantly posed with warm sunset backlight catching the gemstone facets, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The ring must appear physically worn on the finger, not floating or placed beside it.",
    prompts: {
      ring: "The ring is naturally worn on the ring finger of {MODEL} outdoors during golden hour — the band is fully slid onto the finger, fitting snugly and realistically as a worn ring. The hand is elegantly posed with warm sunset backlight catching the gemstone facets, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The ring must appear physically worn on the finger, not floating or placed beside it.",
      earrings: "The earrings are naturally worn on the earlobes of {MODEL} outdoors during golden hour — hanging elegantly and realistically. The model's head is tilted elegantly to catch the warm sunset backlight on the gemstone facets, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The earrings must appear physically worn on the ears, not floating or placed beside them.",
      necklace: "The necklace is naturally worn around the neck of {MODEL} outdoors during golden hour — resting elegantly on the collarbone. The model is posed elegantly to catch the warm sunset backlight on the pendant, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The necklace must appear physically worn on the neck, not floating or placed beside it.",
      bracelet: "The bracelet is naturally worn around the wrist of {MODEL} outdoors during golden hour — resting elegantly on the wrist. The hand is elegantly posed to catch the warm sunset backlight on the details, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The bracelet must appear physically worn on the wrist, not floating or placed beside it.",
      set: "The matching jewelry set is naturally worn by {MODEL} outdoors during golden hour — the earrings on the earlobes and the necklace around the neck. The model is elegantly posed to catch the warm sunset backlight on the jewelry pieces, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The jewelry must appear physically worn, not floating.",
      other: "The product is naturally worn on {MODEL} outdoors during golden hour. Worn realistically to catch the warm sunset backlight, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph. The product must appear physically worn, not floating."
    }
  },
  {
    key: 'silk',
    label: 'Silk flat-lay',
    needsModel: false,
    prompt: 'The ring is placed on its side resting on the band on flowing champagne silk fabric, the gemstone facing upward catching soft directional studio light, elegant gentle fabric folds around the ring, top-down composition, the ring casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
    prompts: {
      ring: 'The ring is placed on its side resting on the band on flowing champagne silk fabric, the gemstone facing upward catching soft directional studio light, elegant gentle fabric folds around the ring, top-down composition, the ring casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
      earrings: 'The earrings are placed elegantly on flowing champagne silk fabric, the gemstones facing upward catching soft directional studio light, elegant gentle fabric folds around the earrings, top-down composition, the earrings cast a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
      necklace: 'The necklace is placed elegantly on flowing champagne silk fabric, the pendant and chain laid out to catch soft directional studio light, elegant gentle fabric folds around the necklace, top-down composition, the necklace casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
      bracelet: 'The bracelet is placed elegantly on flowing champagne silk fabric, laid out to catch soft directional studio light, elegant gentle fabric folds around the bracelet, top-down composition, the bracelet casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
      set: 'The jewelry set (necklace and earrings) is placed elegantly on flowing champagne silk fabric, laid out to catch soft directional studio light, elegant gentle fabric folds around the jewelry, top-down composition, the jewelry casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.',
      other: 'The product is placed elegantly on flowing champagne silk fabric, catching soft directional studio light, elegant gentle fabric folds around the product, top-down composition, the product casts a natural soft shadow on the silk. Refined, airy, and premium catalog look.'
    }
  },
  {
    key: 'velvet',
    label: 'Boutique box',
    needsModel: false,
    prompt: 'The ring is nestled securely inside a premium dark velvet-lined jewelry boutique box, the band resting in the velvet groove, gemstone facing upward under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet hugs the band naturally.',
    prompts: {
      ring: 'The ring is nestled securely inside a premium dark velvet-lined jewelry boutique box, the band resting in the velvet groove, gemstone facing upward under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet hugs the band naturally.',
      earrings: 'The earrings are nestled securely inside a premium dark velvet-lined jewelry boutique box, resting on the soft velvet surface, facing upward under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet cradles the earrings naturally.',
      necklace: 'The necklace is nestled securely inside a premium dark velvet-lined jewelry boutique box, the pendant showcased under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet backdrop highlights the necklace details.',
      bracelet: 'The bracelet is nestled securely inside a premium dark velvet-lined jewelry boutique box, arranged elegantly under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet surrounds the bracelet naturally.',
      set: 'The jewelry set is nestled securely inside a premium dark velvet-lined jewelry boutique box, the matching necklace and earrings displayed under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet highlights the pieces beautifully.',
      other: 'The product is nestled securely inside a premium dark velvet-lined jewelry boutique box, displayed under a single warm studio spotlight. Dark moody background, dramatic high-end commercial presentation, the velvet showcases the product details.'
    }
  },
  {
    key: 'macro',
    label: 'Macro detail',
    needsModel: true,
    prompt: "The ring is naturally worn on the ring finger of {MODEL}, band fully slid onto the finger at the base of the finger joint. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet razor-sharp and radiant. Soft neutral blurred studio backdrop. The ring must appear physically fitted on the finger, realistic and three-dimensional.",
    prompts: {
      ring: "The ring is naturally worn on the ring finger of {MODEL}, band fully slid onto the finger at the base of the finger joint. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet razor-sharp and radiant. Soft neutral blurred studio backdrop. The ring must appear physically fitted on the finger, realistic and three-dimensional.",
      earrings: "The earrings are naturally worn on the earlobes of {MODEL}. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet razor-sharp and radiant. Soft neutral blurred studio backdrop. The earrings must appear physically worn on the ears, realistic and three-dimensional.",
      necklace: "The necklace is naturally worn on the neck of {MODEL}, resting on the skin. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet of the pendant razor-sharp and radiant. Soft neutral blurred studio backdrop. The necklace must appear physically resting on the collarbone, realistic and three-dimensional.",
      bracelet: "The bracelet is naturally worn on the wrist of {MODEL}. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet of the bracelet razor-sharp and radiant. Soft neutral blurred studio backdrop. The bracelet must appear physically fitted on the wrist, realistic and three-dimensional.",
      set: "The jewelry set is naturally worn on {MODEL}. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet razor-sharp and radiant. Soft neutral blurred studio backdrop. The jewelry must appear physically worn, realistic and three-dimensional.",
      other: "The product is naturally worn on {MODEL}. Extreme macro close-up detail shot showing every metal surface, prong, and polished gemstone facet razor-sharp and radiant. Soft neutral blurred studio backdrop. The product must appear physically worn, realistic and three-dimensional."
    }
  }
];

export const GENDERS = [
  { key: 'female', label: 'Female' },
  { key: 'male',   label: 'Male' },
  { key: 'mixed',  label: 'Mixed' }
];

// Each preset carries gender-specific phrasing so male-bridal doesn't inherit female clothing.
export const PRESETS = [
  { key: 'indian_bridal', label: 'Indian bridal', phrases: {
    female: 'a South Asian bride wearing a rich crimson silk saree, intricate gold embroidery, natural elegant bridal makeup, and delicate mehndi details on skin',
    male:   'a South Asian groom in an ivory-and-gold silk sherwani, ornate turban, and sharp grooming',
    mixed:  'a South Asian bridal model in traditional red-and-gold silk wedding attire'
  }},
  { key: 'indian_modern', label: 'Indian modern', phrases: {
    female: 'a modern South Asian woman wearing minimalist contemporary designer wear, soft radiant natural makeup, styled in a warm chic interior',
    male:   'a modern South Asian man wearing a tailored contemporary designer outfit, sharp grooming, natural styling',
    mixed:  'a modern South Asian model wearing minimalist contemporary designer wear, soft natural styling'
  }},
  { key: 'western_edit',  label: 'Western editorial', phrases: {
    female: 'a chic Western fashion model in high-end minimalist editorial apparel, subtle clean-girl makeup, professional studio neutral lighting',
    male:   'a Western fashion model in a sharply tailored minimalist suit, clean-cut styling, neutral studio lighting',
    mixed:  'a Western fashion model in minimalist high-fashion attire, clean-cut styling'
  }},
  { key: 'middle_east',   label: 'Middle-Eastern', phrases: {
    female: 'a Middle-Eastern woman in a luxurious modern abaya, soft dewy makeup, elegant regal styling, in a modern luxury villa lounge',
    male:   'a Middle-Eastern man in a pristine white thobe and bisht with refined gold embroidery, clean royal grooming',
    mixed:  'a Middle-Eastern model in elegant royal attire, sophisticated styling'
  }},
  { key: 'east_asian',    label: 'East Asian', phrases: {
    female: 'an East Asian fashion model in minimalist designer apparel, soft natural makeup, sleek hair, warm minimalist studio lighting',
    male:   'an East Asian man in a minimalist designer outfit, refined contemporary grooming, warm studio styling',
    mixed:  'an East Asian model in a minimalist modern outfit, soft natural styling'
  }},
  { key: 'african',       label: 'African elegance', phrases: {
    female: 'a beautiful African model with glowing radiant skin tones, wearing contemporary minimalist designer wear, natural makeup, editorial portrait lighting',
    male:   'a handsome African man in a bold contemporary designer outfit, radiant skin tones, confident styling',
    mixed:  'an African model in a bold contemporary outfit, radiant skin tones'
  }},
  { key: 'clean',         label: 'Clean / unspecified', phrases: {
    female: 'an elegant female model with soft neutral styling',
    male:   'a refined male model with soft neutral styling',
    mixed:  'a stylish model with soft neutral styling'
  }}
];

export const ANGLES = [
  { key: 'front', label: 'Front',   phrase: 'shot from the front, symmetrical composition' },
  { key: 'side',  label: 'Side',    phrase: 'shot from a clean side profile angle' },
  { key: 'angle', label: '45°',     phrase: 'shot from a 45-degree three-quarter angle' },
  { key: 'back',  label: 'Back',    phrase: 'shot from behind, showing the clasp and reverse detail' },
  { key: 'top',   label: 'Top-down',phrase: 'shot from directly above in top-down composition' }
];

/**
 * Build the model phrase used to interpolate {MODEL} in scene prompts.
 * Uses whichever cultural preset is chosen, biased with gender.
 */
export function buildModelPhrase({ gender = 'female', preset = 'clean' }) {
  const p = PRESETS.find(x => x.key === preset) || PRESETS[PRESETS.length - 1];
  const g = ['female','male','mixed'].includes(gender) ? gender : 'female';
  return p.phrases[g] || p.phrases.female;
}

// Kept in sync with the documented default scene set used elsewhere
// (server.js defaults, store.js getSettings defaults). Do NOT use
// SCENES.slice(0, 4) here — SCENES[0] is the 'copy_only' placeholder,
// not a real scene, so slicing silently dropped 'silk' and included a
// dummy entry instead.
const DEFAULT_SCENE_KEYS = ['marble', 'model', 'golden', 'silk'];

export function resolveScenes(sceneKeys) {
  const keys = sceneKeys && sceneKeys.length ? sceneKeys : DEFAULT_SCENE_KEYS;
  return keys.map(k => SCENES.find(s => s.key === k)).filter(Boolean);
}

export function resolveAngles(angleKeys) {
  if (!angleKeys || !angleKeys.length) return [];
  return angleKeys.map(k => ANGLES.find(a => a.key === k)).filter(Boolean);
}
