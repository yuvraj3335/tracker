import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}
