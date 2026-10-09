import { Box } from 'lucide-react';
import { useSiteSettings } from '../shared/site/SiteSettingsProvider';

export const BRAND_NAME = 'BlockSet';
export const BRAND_COURSE_TITLE = `${BRAND_NAME} course`;
export const BRAND_SUBTITLE = '探索・學習・實作';

export function BrandMark({ size = 22 }: { size?: number }) {
  const { settings } = useSiteSettings();
  if (settings.logoDataUrl) return <img className="brand-mark-image" src={settings.logoDataUrl} width={size} height={size} alt="" aria-hidden="true" />;
  return <Box size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Wordmark() {
  const { settings } = useSiteSettings();
  return <span className="wordmark"><strong>{settings.title}</strong><span className="wordmark-course">course</span></span>;
}
