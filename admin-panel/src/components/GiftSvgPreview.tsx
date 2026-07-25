// GiftSvgPreview — web mirror of the mobile AnimatedGiftIcon artwork.
// Renders the same hand-authored SVG gifts (so the admin preview matches what
// users/hosts see) with a light CSS animation. Reference by "svg:<name>" token.
//
// Keep the gift names + paths in sync with:
//   voxlink/components/AnimatedGiftIcon.tsx
//   voxlink-host/components/AnimatedGiftIcon.tsx

import { useEffect } from 'react';

export const ANIMATED_GIFT_NAMES = [
  'heart',
  'star',
  'diamond',
  'crown',
  'gift-box',
  'rose',
  'fire',
  'rocket',
  'coin',
  'trophy',
  'sparkle',
  'lollipop',
] as const;

export type AnimatedGiftName = (typeof ANIMATED_GIFT_NAMES)[number];

export const ANIMATED_GIFT_LABELS: Record<AnimatedGiftName, string> = {
  heart: 'Heart',
  star: 'Star',
  diamond: 'Diamond',
  crown: 'Crown',
  'gift-box': 'Gift Box',
  rose: 'Rose',
  fire: 'Fire',
  rocket: 'Rocket',
  coin: 'Coin',
  trophy: 'Trophy',
  sparkle: 'Sparkle',
  lollipop: 'Lollipop',
};

const GIFT_ANIM: Record<AnimatedGiftName, string> = {
  heart: 'vc-beat',
  star: 'vc-twinkle',
  diamond: 'vc-twinkle',
  crown: 'vc-swing',
  'gift-box': 'vc-bounce',
  rose: 'vc-swing',
  fire: 'vc-flicker',
  rocket: 'vc-launch',
  coin: 'vc-spin',
  trophy: 'vc-beat',
  sparkle: 'vc-twinkle',
  lollipop: 'vc-spin',
};

/** Returns the gift name if `s` is a "svg:<name>" token, else null. */
export function parseSvgGift(s?: string): AnimatedGiftName | null {
  if (!s) return null;
  const m = s.trim().match(/^svg:(.+)$/i);
  if (!m) return null;
  const name = m[1].toLowerCase() as AnimatedGiftName;
  return (ANIMATED_GIFT_NAMES as readonly string[]).includes(name) ? name : null;
}

export function isSvgGift(s?: string): boolean {
  return parseSvgGift(s) !== null;
}

let stylesInjected = false;
function useGiftStyles() {
  useEffect(() => {
    if (stylesInjected) return;
    stylesInjected = true;
    const el = document.createElement('style');
    el.setAttribute('data-vc-gift', '');
    el.textContent = `
@keyframes vc-beat { 0%,100%{transform:scale(1)} 50%{transform:scale(1.14)} }
@keyframes vc-twinkle { 0%,100%{transform:scale(.94) rotate(0);opacity:.8} 50%{transform:scale(1.06) rotate(16deg);opacity:1} }
@keyframes vc-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
@keyframes vc-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10%)} }
@keyframes vc-flicker { 0%,100%{transform:scale(1,1)} 50%{transform:scale(.95,1.12)} }
@keyframes vc-launch { 0%,100%{transform:translateY(0) rotate(-5deg)} 50%{transform:translateY(-12%) rotate(5deg)} }
@keyframes vc-swing { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
.vc-beat{animation:vc-beat 1.2s ease-in-out infinite;transform-origin:center}
.vc-twinkle{animation:vc-twinkle 1.4s ease-in-out infinite;transform-origin:center}
.vc-spin{animation:vc-spin 3s linear infinite;transform-origin:center}
.vc-bounce{animation:vc-bounce 1.2s ease-in-out infinite;transform-origin:center}
.vc-flicker{animation:vc-flicker .7s ease-in-out infinite;transform-origin:center}
.vc-launch{animation:vc-launch 1.6s ease-in-out infinite;transform-origin:center}
.vc-swing{animation:vc-swing 1.4s ease-in-out infinite;transform-origin:center}
`;
    document.head.appendChild(el);
  }, []);
}

interface Props {
  name: AnimatedGiftName;
  size?: number;
  animate?: boolean;
  className?: string;
}

export function GiftSvgPreview({ name, size = 48, animate = true, className }: Props) {
  useGiftStyles();
  const anim = animate ? GIFT_ANIM[name] : '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`${anim} ${className || ''}`.trim()}
      style={{ display: 'block' }}
    >
      {renderGift(name)}
    </svg>
  );
}

function renderGift(name: AnimatedGiftName) {
  const id = name; // gradient ids namespaced per gift
  switch (name) {
    case 'heart':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FF7EB3" />
              <stop offset="1" stopColor="#FF2D6F" />
            </linearGradient>
          </defs>
          <path
            d="M24 42S6 30.5 6 17.8C6 11.3 11 7 16.4 7c3.6 0 6.2 1.9 7.6 4.4C25.4 8.9 28 7 31.6 7 37 7 42 11.3 42 17.8 42 30.5 24 42 24 42z"
            fill={`url(#${id}-a)`}
          />
          <path d="M14 15c1.2-2.7 3.6-4 6-4" stroke="#FFD1E3" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.8} />
        </>
      );
    case 'star':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFE47A" />
              <stop offset="1" stopColor="#FFB300" />
            </linearGradient>
          </defs>
          <path
            d="M24 4l6.1 12.4 13.7 2-9.9 9.7 2.3 13.6L24 35.3 11.8 41.7l2.3-13.6L4.2 18.4l13.7-2z"
            fill={`url(#${id}-a)`}
            stroke="#FF9800"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </>
      );
    case 'diamond':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8EF6FF" />
              <stop offset="1" stopColor="#2EA6FF" />
            </linearGradient>
          </defs>
          <path d="M13 6h22l8 11-19 25L5 17z" fill={`url(#${id}-a)`} />
          <path d="M13 6l6 11-9 0zM35 6l-6 11 9 0zM19 17h10l-5 25zM19 17l-9 0 14 25zM29 17l9 0-14 25z" fill="#FFFFFF" opacity={0.22} />
          <path d="M13 6h22l8 11H5z" fill="#FFFFFF" opacity={0.14} />
        </>
      );
    case 'crown':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFE47A" />
              <stop offset="1" stopColor="#FFB300" />
            </linearGradient>
          </defs>
          <path
            d="M6 16l7 7 11-14 11 14 7-7v22a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"
            fill={`url(#${id}-a)`}
            stroke="#F08C00"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <circle cx="6" cy="16" r="3" fill="#FF5DA2" />
          <circle cx="42" cy="16" r="3" fill="#FF5DA2" />
          <circle cx="24" cy="9" r="3" fill="#FF5DA2" />
          <circle cx="24" cy="34" r="3" fill="#FFFFFF" opacity={0.7} />
        </>
      );
    case 'gift-box':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#B06BFF" />
              <stop offset="1" stopColor="#7A1FE0" />
            </linearGradient>
          </defs>
          <rect x="8" y="20" width="32" height="22" rx="3" fill={`url(#${id}-a)`} />
          <rect x="6" y="14" width="36" height="9" rx="3" fill="#8A2BE2" />
          <rect x="21" y="14" width="6" height="28" fill="#FFD54A" />
          <path d="M24 14c-4-6-12-6-11-1 0 3 6 3 11 1zM24 14c4-6 12-6 11-1 0 3-6 3-11 1z" fill="#FFD54A" />
          <circle cx="24" cy="14" r="2.6" fill="#FFB300" />
        </>
      );
    case 'rose':
      return (
        <>
          <defs>
            <radialGradient id={`${id}-a`} cx="0.5" cy="0.4" r="0.6">
              <stop offset="0" stopColor="#FF6A8B" />
              <stop offset="1" stopColor="#D6155B" />
            </radialGradient>
          </defs>
          <path d="M24 44c-1 0-1.4-6-1.4-12S23 22 24 22s1.4 4 1.4 10S25 44 24 44z" fill="#2E9E5B" />
          <path d="M24 34c-6 0-9-3-11-6 4 0 7 1 11 3zM24 32c6 0 9-3 11-6-4 0-7 1-11 3z" fill="#37B368" />
          <circle cx="24" cy="16" r="12" fill={`url(#${id}-a)`} />
          <path d="M24 8c-4 1-6 4-6 8s3 7 6 7 6-3 6-7-2-7-6-8z" fill="#FF97AE" opacity={0.7} />
          <circle cx="24" cy="16" r="3.4" fill="#B10E4C" />
        </>
      );
    case 'fire':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFD24A" />
              <stop offset="0.5" stopColor="#FF7A00" />
              <stop offset="1" stopColor="#FF2D2D" />
            </linearGradient>
          </defs>
          <path
            d="M24 4c2 6-2 8-2 12 0 2 1.6 3.5 3.4 3.5 1.7 0 2.6-1.5 2.6-3.5 4 3 8 8 8 15A12 12 0 1 1 12 31c0-6 4-10 7-14 1.7 2 1.7 4 .3 6-1.3 2 .4 4.5 2.4 4.5 2.2 0 3.6-2.2 3.6-5C36-2 24 0 24 4z"
            fill={`url(#${id}-a)`}
          />
          <path d="M24 24c1.6 1.6 2.4 3.4 2.4 5.4 0 2.4-1.8 4.2-4 4.2s-4-1.8-4-4.2c0-2.6 2-4 3.6-5.4z" fill="#FFE27A" />
        </>
      );
    case 'rocket':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F2F5FF" />
              <stop offset="1" stopColor="#C3CBE0" />
            </linearGradient>
          </defs>
          <path d="M24 3c7 4 11 12 11 22l-4 6H17l-4-6C13 15 17 7 24 3z" fill={`url(#${id}-a)`} />
          <path d="M17 31l-6 4 2-9zM31 31l6 4-2-9z" fill="#FF5252" />
          <circle cx="24" cy="19" r="5" fill="#2EA6FF" />
          <circle cx="24" cy="19" r="2.4" fill="#0B4E8C" />
          <path d="M20 37h8l-2 6c-.7 1.6-3.3 1.6-4 0z" fill="#FF9800" />
          <path d="M22 40h4l-1 3c-.4.9-1.6.9-2 0z" fill="#FFD24A" />
        </>
      );
    case 'coin':
      return (
        <>
          <defs>
            <radialGradient id={`${id}-a`} cx="0.4" cy="0.35" r="0.7">
              <stop offset="0" stopColor="#FFE68A" />
              <stop offset="1" stopColor="#F5A623" />
            </radialGradient>
          </defs>
          <circle cx="24" cy="24" r="19" fill="#C97E12" />
          <circle cx="24" cy="24" r="16" fill={`url(#${id}-a)`} />
          <circle cx="24" cy="24" r="12" fill="none" stroke="#C97E12" strokeWidth={1.6} opacity={0.7} />
          <path d="M24 14v20M18.5 18h8a3.5 3.5 0 0 1 0 7h-6a3.5 3.5 0 0 0 0 7h8" stroke="#8A5A0B" strokeWidth={2.6} strokeLinecap="round" fill="none" />
        </>
      );
    case 'trophy':
      return (
        <>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFE47A" />
              <stop offset="1" stopColor="#F5A623" />
            </linearGradient>
          </defs>
          <path d="M14 6h20v10a10 10 0 0 1-20 0z" fill={`url(#${id}-a)`} />
          <path d="M14 8H8v4a7 7 0 0 0 7 7M34 8h6v4a7 7 0 0 1-7 7" stroke="#F5A623" strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <rect x="21" y="26" width="6" height="8" fill="#E68A00" />
          <rect x="15" y="34" width="18" height="5" rx="1.5" fill="#C97E12" />
          <rect x="12" y="39" width="24" height="4" rx="1.5" fill="#8A5A0B" />
        </>
      );
    case 'sparkle':
      return (
        <>
          <defs>
            <radialGradient id={`${id}-a`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#8EE7FF" />
            </radialGradient>
          </defs>
          <path d="M24 4c1.5 9 5 12.5 14 14-9 1.5-12.5 5-14 14-1.5-9-5-12.5-14-14 9-1.5 12.5-5 14-14z" fill={`url(#${id}-a)`} />
          <path d="M38 6c.7 3.3 1.7 4.3 5 5-3.3.7-4.3 1.7-5 5-.7-3.3-1.7-4.3-5-5 3.3-.7 4.3-1.7 5-5z" fill="#FFE47A" />
          <circle cx="10" cy="38" r="3" fill="#FF7EB3" />
        </>
      );
    case 'lollipop':
      return (
        <>
          <defs>
            <radialGradient id={`${id}-a`} cx="0.4" cy="0.4" r="0.7">
              <stop offset="0" stopColor="#FF9AD1" />
              <stop offset="1" stopColor="#E5399B" />
            </radialGradient>
          </defs>
          <rect x="22.5" y="24" width="3" height="20" rx="1.5" fill="#E0E6F0" />
          <circle cx="24" cy="17" r="13" fill={`url(#${id}-a)`} />
          <path
            d="M24 17a5 5 0 0 1 5-5 5 5 0 0 1 5 5 9 9 0 0 1-9 9 9 9 0 0 1-9-9 6 6 0 0 1 6-6"
            stroke="#FFFFFF"
            strokeWidth={2.2}
            fill="none"
            opacity={0.75}
            strokeLinecap="round"
          />
          <ellipse cx="19" cy="12" rx="3" ry="2" fill="#FFFFFF" opacity={0.5} />
        </>
      );
    default:
      return null;
  }
}

export default GiftSvgPreview;
