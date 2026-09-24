---
name: NTVio Live
description: Studio Broadcast Monitor meets High-End Glassmorphism
colors:
  bg-canvas: "#05070b"
  bg-canvas-subtle: "#080b12"
  bg-surface: "rgba(13, 17, 27, 0.72)"
  bg-surface-elevated: "rgba(20, 26, 42, 0.85)"
  glass-border: "rgba(255, 255, 255, 0.08)"
  glass-border-hover: "rgba(255, 255, 255, 0.22)"
  glass-highlight: "rgba(255, 255, 255, 0.16)"
  accent-emerald: "#10b981"
  emerald-bright: "#34d399"
  emerald-light: "#6ee7b7"
  accent-cyan: "#06b6d4"
  cyan-light: "#a5f3fc"
  accent-indigo: "#6366f1"
  indigo-light: "#c7d2fe"
  accent-rose: "#f43f5e"
  rose-light: "#fecdd3"
  accent-amber: "#f59e0b"
  amber-light: "#fde68a"
  accent-purple: "#a855f7"
  purple-light: "#e9d5ff"
  accent-red: "#ef4444"
  red-light: "#fca5a5"
  red-subtle: "rgba(239, 68, 68, 0.18)"
  indigo-300: "#a5b4fc"
  overlay-dark: "rgba(0, 0, 0, 0.4)"
  black: "#000000"
  white: "#ffffff"
  text-primary: "#f8fafc"
  text-secondary: "#94a3b8"
  text-muted: "#64748b"
  text-subtle: "#475569"
  slate-light: "#cbd5e1"
typography:
  display:
    fontFamily: "'Outfit', system-ui, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "'JetBrains Mono', monospace"
    fontWeight: 500
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  2xl: "26px"
  full: "9999px"
---

# Design System: NTVio Live

## Overview
NTVio Live combines the functional precision of a professional sports broadcast monitor with high-end optical glassmorphism. It features luminous frosted glass panels, ambient colored glows, multi-stop borders, and clean typography.

## Colors
- **Canvas**: Deep Obsidian Void (`#05070b`) with subtle ambient radial gradients in deep teal, nocturnal violet, and emerald.
- **Glass Surfaces**: Frosted dark glass (`rgba(13, 17, 27, 0.72)`) backed by `backdrop-filter: blur(28px) saturate(190%)`.
- **Live State (Emerald)**: Vivid `#10b981` with tints `#34d399` and `#6ee7b7` indicating active live broadcast matches.
- **24/7 TV State (Electric Indigo)**: High-tech `#6366f1` and `#c7d2fe` for continuous streaming channels.
- **Accents**: Cyan (`#06b6d4`, `#a5f3fc`), Amber (`#f59e0b`, `#fde68a`), Purple (`#a855f7`, `#e9d5ff`), and Rose (`#f43f5e`, `#fecdd3`) for category markers and favorite toggles.

## Typography
- **Headings**: `Outfit`, 600/700/800 weight, tight tracking (`-0.02em` to `-0.03em`) for punchy, distinct broadcast titles.
- **Body**: `DM Sans`, 400/500 weight, with strict contrast (never washed-out gray).
- **Technical Meta**: `JetBrains Mono` with `tabular-nums` for timestamps, counts, bitrates, and server labels.

## Layout
- Dynamic top glass navigation bar with brand badge, tab pills, global instant search, and live server telemetry.
- Studio Marquee Ticker with live match events.
- Hero Video Monitor with cinema Theater mode and custom frosted controls.
- Ergonomic filters bar (server selector chips, category pills, live-only switch).
- Responsive adaptive card grids with smooth fluid scaling across mobile, tablet, and desktop monitors.

## Elevation & Depth
- **Optical Glass Stack**: Top specular white rim (`1px solid rgba(255,255,255,0.16)`), dark body, and deep soft drop shadow (`0 20px 48px -10px rgba(0,0,0,0.75)`).
- **Luminous Glows**: Cards and active player container cast soft ambient light onto the canvas.

## Shapes & Interactions
- Soft squircle corners (`10px` to `26px` radius).
- Micro-interactions: Cards lift smoothly (`transform: translateY(-4px)`), borders brighten, play icons scale with spring precision.
- Buttons provide instant feedback with spinner transitions on click.

## Do's and Don'ts
- **DO**: Use genuine optical glassmorphism with backdrop filters and translucent borders.
- **DO**: Maintain high contrast between text and backgrounds (minimum 4.5:1).
- **DO**: Keep layout clean, breathing, and organized with clear visual hierarchy.
- **DON'T**: Use flat plain black/gray boxes or clunky nested cards.
- **DON'T**: Use low-contrast gray text on dark surfaces.
- **DON'T**: Clutter the interface with unnecessary decorative banners or popups.
