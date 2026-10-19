import { useState } from 'react';
import { Globe } from 'lucide-react';

// A site's icon (a data: URL), or the globe when there isn't one or it won't decode.
function SiteIcon({ src, size = 16 }: { src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return <Globe size={size - 2} strokeWidth={1.75} className="shrink-0 text-zinc-500" aria-hidden="true" />;
  }

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-[3px] object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export default SiteIcon;
