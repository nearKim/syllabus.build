// GENERATED FILE — DO NOT EDIT MANUALLY. Source of truth: specs/product.md
// Canonical Specification SHA-256: b7ad9df9344dd0483a8775fa04be05470a631597c22244fe2f578bbba3627c44

export const UI_TOKENS = {
  "$comment": "GENERATED FILE \u2014 DO NOT EDIT MANUALLY. Source of truth: specs/product.md",
  "specification_version": "0.3.0",
  "status": "adopted implementation defaults; rendered accessibility still requires verification",
  "colors": {
    "canvas": {
      "light": "#F7F8FA",
      "dark": "#101216"
    },
    "surface": {
      "light": "#FFFFFF",
      "dark": "#191D24"
    },
    "surface-secondary": {
      "light": "#EDF0F4",
      "dark": "#242A33"
    },
    "text-primary": {
      "light": "#17191C",
      "dark": "#F4F6F8"
    },
    "text-secondary": {
      "light": "#5B636E",
      "dark": "#B5BEC9"
    },
    "border-subtle": {
      "light": "#D5DAE0",
      "dark": "#3D4654"
    },
    "border-control": {
      "light": "#7D8794",
      "dark": "#8793A5"
    },
    "action-fill": {
      "light": "#17191C",
      "dark": "#F4F6F8"
    },
    "action-text": {
      "light": "#FFFFFF",
      "dark": "#17191C"
    },
    "accent": {
      "light": "#2259D4",
      "dark": "#9DBAFF"
    },
    "accent-surface": {
      "light": "#EAF0FF",
      "dark": "#1B2C4D"
    },
    "success-text": {
      "light": "#166534",
      "dark": "#86E2AC"
    },
    "success-surface": {
      "light": "#EAF6EF",
      "dark": "#162E23"
    },
    "warning-text": {
      "light": "#854D0E",
      "dark": "#F3CD7A"
    },
    "warning-surface": {
      "light": "#FFF6DE",
      "dark": "#342B18"
    },
    "danger-text": {
      "light": "#B42318",
      "dark": "#FFA6A0"
    },
    "danger-surface": {
      "light": "#FFF0EE",
      "dark": "#3A2020"
    }
  },
  "spacing_css_px": [
    4,
    8,
    12,
    16,
    24,
    32,
    48,
    64
  ],
  "breakpoints_css_px": {
    "medium_min": 768,
    "wide_min": 1200
  },
  "layout_css_px": {
    "sidebar_wide": 224,
    "content_max": 1280,
    "gutter_compact": 16,
    "gutter_medium": 24,
    "gutter_wide": 32,
    "touch_target_min": 44,
    "primary_compact_target": 48
  },
  "effects": {
    "glass_opacity": 0.92,
    "backdrop_blur_css_px": 12,
    "transition_ms": [
      120,
      180
    ],
    "sheet_max_ms": 220,
    "opaque_content": true,
    "system_reduction_wins": true
  }
} as const;

export type ThemeMode = "light" | "dark";
export type SemanticColorToken = keyof typeof UI_TOKENS.colors;
