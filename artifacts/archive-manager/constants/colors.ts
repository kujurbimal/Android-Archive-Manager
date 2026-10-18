/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#17352D',
    tint: '#1C624B',

    // Core surfaces
    background: '#F6F5EF',
    foreground: '#17352D',

    // Cards / elevated surfaces
    card: '#FFFDF7',
    cardForeground: '#17352D',

    // Primary action color (buttons, links, active states)
    primary: '#1C624B',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#EEEDE5',
    secondaryForeground: '#27473D',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E9E7DE',
    mutedForeground: '#747D76',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E4EEE7',
    accentForeground: '#28533F',

    // Destructive actions (delete, error states)
    destructive: '#B64F41',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#DEDED5',
    input: '#DEDED5',
  },

  dark: {
    text: '#F4F3EB',
    tint: '#91C8A8',
    background: '#101D19',
    foreground: '#F4F3EB',
    card: '#172722',
    cardForeground: '#F4F3EB',
    primary: '#91C8A8',
    primaryForeground: '#14382B',
    secondary: '#243831',
    secondaryForeground: '#E7EFE9',
    muted: '#243831',
    mutedForeground: '#A5B6AE',
    accent: '#20382F',
    accentForeground: '#B8DCC5',
    destructive: '#E37E6E',
    destructiveForeground: '#21120F',
    border: '#2A4038',
    input: '#2A4038',
  },

  radius: 14,
};

export default colors;
