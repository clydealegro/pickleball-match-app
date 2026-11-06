export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Provided once player photos exist; initials are shown until then. */
  photoUrl?: string;
}

export function Avatar({ name, size = 'md', photoUrl }: AvatarProps) {
  if (photoUrl) {
    return <img className={`avatar avatar-${size}`} src={photoUrl} alt={name} />;
  }
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
