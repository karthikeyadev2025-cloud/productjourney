// lib/presets.js — reusable creative controls

export const SCENES = [
  { key: 'marble',  label: 'Marble luxury',   prompt: 'Clean transparent-style product cutout placed on a clean luxury white-and-grey marble surface, soft studio lighting, subtle natural shadow beneath the piece, minimal premium catalog look.', needsModel: false },
  { key: 'model',   label: 'Model editorial', prompt: "Placed naturally on {MODEL}'s neck or wrist (choose whichever fits the jewelry type), close-up editorial fashion photograph, soft skin tones, shallow depth of field, high-fashion magazine style.", needsModel: true },
  { key: 'golden',  label: 'Golden hour',     prompt: 'Worn by {MODEL} outdoors during golden hour, warm sunset backlight, soft lens flare, dreamy bokeh background, premium lifestyle campaign photograph.', needsModel: true },
  { key: 'silk',    label: 'Silk flat-lay',   prompt: 'Set standalone as a luxury lifestyle flat-lay on flowing champagne silk sheets, gentle folds catching soft light, top-down composition, refined and airy.', needsModel: false },
  { key: 'velvet',  label: 'Velvet display',  prompt: 'Presented inside a deep emerald velvet jewelry display box under a single warm studio spotlight, dark moody background, dramatic boutique presentation.', needsModel: false },
  { key: 'macro',   label: 'Hand macro',      prompt: "Held delicately between {MODEL}'s fingertips, extreme macro detail shot, every stone facet and metal texture crisp, neutral blurred studio background.", needsModel: true }
];

export const GENDERS = [
  { key: 'female', label: 'Female', phrase: 'an elegant female model' },
  { key: 'male',   label: 'Male',   phrase: 'a refined male model' },
  { key: 'mixed',  label: 'Mixed',  phrase: 'a stylish model' }
];

// Each preset carries gender-specific phrasing so male-bridal doesn't inherit female clothing.
export const PRESETS = [
  { key: 'indian_bridal', label: 'Indian bridal', phrases: {
    female: 'a graceful South Asian bride in a rich red-and-gold silk saree with traditional bridal makeup and mehndi',
    male:   'a South Asian groom in an ivory-and-gold silk sherwani with an ornate turban',
    mixed:  'a South Asian bridal figure in traditional red-and-gold silk attire'
  }},
  { key: 'indian_modern', label: 'Indian modern', phrases: {
    female: 'a modern South Asian woman in an elegant contemporary outfit, minimal makeup, natural styling',
    male:   'a modern South Asian man in a tailored contemporary outfit, sharp grooming, natural styling',
    mixed:  'a modern South Asian model in an elegant contemporary outfit, minimal styling'
  }},
  { key: 'western_edit',  label: 'Western editorial', phrases: {
    female: 'a Western fashion model in a minimalist high-fashion outfit, editorial styling, muted palette',
    male:   'a Western fashion model in a sharply tailored minimalist suit, editorial styling, muted palette',
    mixed:  'a Western fashion model in minimalist high-fashion attire, editorial styling, muted palette'
  }},
  { key: 'middle_east',   label: 'Middle-Eastern', phrases: {
    female: 'a Middle-Eastern woman in an elegant abaya or evening gown, sophisticated makeup, royal styling',
    male:   'a Middle-Eastern man in a pristine white thobe and bisht with refined details, royal styling',
    mixed:  'a Middle-Eastern model in elegant royal attire, sophisticated styling'
  }},
  { key: 'east_asian',    label: 'East Asian', phrases: {
    female: 'an East Asian woman in a minimalist modern outfit, soft natural makeup, elegant hair',
    male:   'an East Asian man in a minimalist modern outfit, refined grooming, elegant styling',
    mixed:  'an East Asian model in a minimalist modern outfit, soft natural styling'
  }},
  { key: 'african',       label: 'African elegance', phrases: {
    female: 'an African woman with a bold statement outfit, radiant skin tones, contemporary styling',
    male:   'an African man in a bold contemporary outfit, radiant skin tones, confident styling',
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

export function resolveScenes(sceneKeys) {
  const chosen = sceneKeys && sceneKeys.length
    ? sceneKeys.map(k => SCENES.find(s => s.key === k)).filter(Boolean)
    : SCENES.slice(0, 4);
  return chosen;
}

export function resolveAngles(angleKeys) {
  if (!angleKeys || !angleKeys.length) return [];
  return angleKeys.map(k => ANGLES.find(a => a.key === k)).filter(Boolean);
}
