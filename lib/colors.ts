export interface ColorProfile {
  id: string;
  name: string;
  nameFa: string;
  bg: string;
  border: string;
  ring: string;
  text: string;
  glow: string;
  gradient: string;
}

export const SEQUENTIAL_COLORS: ColorProfile[] = [
  {
    id: 'emerald',
    name: 'Emerald',
    nameFa: 'زمردی',
    bg: '#059669',
    border: '#10b981',
    ring: '#34d399',
    text: '#ffffff',
    glow: 'rgba(16, 185, 129, 0.45)',
    gradient: 'from-emerald-500 to-teal-700',
  },
  {
    id: 'violet',
    name: 'Violet',
    nameFa: 'بنفش سلطنتی',
    bg: '#7c3aed',
    border: '#8b5cf6',
    ring: '#a78bfa',
    text: '#ffffff',
    glow: 'rgba(139, 92, 246, 0.45)',
    gradient: 'from-purple-500 to-indigo-700',
  },
  {
    id: 'amber',
    name: 'Amber',
    nameFa: 'کهربایی',
    bg: '#d97706',
    border: '#f59e0b',
    ring: '#fbbf24',
    text: '#ffffff',
    glow: 'rgba(245, 158, 11, 0.45)',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    id: 'rose',
    name: 'Rose',
    nameFa: 'رز صورتی',
    bg: '#e11d48',
    border: '#f43f5e',
    ring: '#fb7185',
    text: '#ffffff',
    glow: 'rgba(244, 63, 94, 0.45)',
    gradient: 'from-rose-500 to-pink-700',
  },
  {
    id: 'cyan',
    name: 'Cyan',
    nameFa: 'فیروزه‌ای',
    bg: '#0891b2',
    border: '#06b6d4',
    ring: '#22d3ee',
    text: '#ffffff',
    glow: 'rgba(6, 182, 212, 0.45)',
    gradient: 'from-cyan-500 to-blue-700',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    nameFa: 'نیلی تیره',
    bg: '#4f46e5',
    border: '#6366f1',
    ring: '#818cf8',
    text: '#ffffff',
    gradient: 'from-indigo-500 to-blue-800',
    glow: 'rgba(99, 102, 241, 0.45)',
  },
  {
    id: 'orange',
    name: 'Orange',
    nameFa: 'نارنجی پرتقالی',
    bg: '#ea580c',
    border: '#f97316',
    ring: '#fb923c',
    text: '#ffffff',
    glow: 'rgba(249, 115, 22, 0.45)',
    gradient: 'from-orange-500 to-amber-600',
  },
  {
    id: 'teal',
    name: 'Teal',
    nameFa: 'سبز آبی',
    bg: '#0d9488',
    border: '#14b8a6',
    ring: '#2dd4bf',
    text: '#ffffff',
    glow: 'rgba(20, 184, 166, 0.45)',
    gradient: 'from-teal-500 to-emerald-700',
  },
  {
    id: 'fuchsia',
    name: 'Fuchsia',
    nameFa: 'سرخابی',
    bg: '#c026d3',
    border: '#d946ef',
    ring: '#e879f9',
    text: '#ffffff',
    glow: 'rgba(217, 70, 239, 0.45)',
    gradient: 'from-fuchsia-500 to-pink-600',
  },
  {
    id: 'sky',
    name: 'Sky Blue',
    nameFa: 'آبی آسمانی',
    bg: '#0284c7',
    border: '#0ea5e9',
    ring: '#38bdf8',
    text: '#ffffff',
    glow: 'rgba(14, 165, 233, 0.45)',
    gradient: 'from-sky-500 to-blue-600',
  },
  {
    id: 'lime',
    name: 'Lime',
    nameFa: 'لیمویی روشن',
    bg: '#65a30d',
    border: '#84cc16',
    ring: '#a3e635',
    text: '#ffffff',
    glow: 'rgba(132, 204, 22, 0.45)',
    gradient: 'from-lime-500 to-green-600',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    nameFa: 'زرشکی',
    bg: '#be123c',
    border: '#e11d48',
    ring: '#f43f5e',
    text: '#ffffff',
    glow: 'rgba(225, 29, 72, 0.45)',
    gradient: 'from-red-600 to-rose-800',
  },
];

export function getColorByOrder(orderIndex: number): ColorProfile {
  const safeIndex = Math.abs(orderIndex) % SEQUENTIAL_COLORS.length;
  return SEQUENTIAL_COLORS[safeIndex];
}
