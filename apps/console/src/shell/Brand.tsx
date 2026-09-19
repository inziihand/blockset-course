import { Box } from 'lucide-react';

export function BrandMark({ size = 22 }: { size?: number }) {
  return <Box size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Wordmark() {
  return <span className="wordmark">Strat<span>Exec</span></span>;
}
