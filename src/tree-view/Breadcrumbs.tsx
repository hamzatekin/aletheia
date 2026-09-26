import { Link } from 'react-router';
import { plainText } from '@/editor/markdown';
import { useAncestors } from './use-outline';

interface Props {
  rootId: string;
}

/** Home › ancestor › ancestor. Clicking any crumb zooms out to it. */
export function Breadcrumbs({ rootId }: Props) {
  const ancestors = useAncestors(rootId);
  const crumb = 'max-w-48 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-ink pointer-coarse:px-2 pointer-coarse:py-1.5';
  return (
    <nav aria-label="Breadcrumbs" className="mb-3 flex flex-wrap items-center text-sm text-muted">
      <Link to="/" className={crumb}>
        Home
      </Link>
      {ancestors.map((a) => (
        <span key={a.id} className="flex items-center">
          <span className="mx-0.5 select-none text-faint">›</span>
          <Link to={`/n/${a.id}`} className={crumb}>
            {plainText(a.content) || 'Untitled'}
          </Link>
        </span>
      ))}
    </nav>
  );
}
