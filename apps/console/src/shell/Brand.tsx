import { Box } from 'lucide-react';

export const BRAND_SUBTITLE = '探索・學習・實作';

export function BrandMark({ size = 22 }: { size?: number }) {
  return <Box size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Wordmark() {
  return <span className="wordmark">course.<strong>BlockSet</strong></span>;
}
