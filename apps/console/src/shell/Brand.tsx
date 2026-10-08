import { Box } from 'lucide-react';

export const BRAND_NAME = 'BlockSet';
export const BRAND_COURSE_TITLE = `${BRAND_NAME} course`;
export const BRAND_SUBTITLE = '探索・學習・實作';

export function BrandMark({ size = 22 }: { size?: number }) {
  return <Box size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Wordmark() {
  return <span className="wordmark"><strong>{BRAND_NAME}</strong><span className="wordmark-course">course</span></span>;
}
