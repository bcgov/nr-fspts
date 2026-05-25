import type { FC } from 'react';
import './AvatarImage.css';

type Size = 'small' | 'large';

interface AvatarImageProps {
  userName: string;
  size: Size;
}

function getInitials(userName: string): string {
  if (!userName) return '';
  const parts = userName.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] || '') + (parts[1][0] || '');
  if (parts.length === 1) return parts[0][0] || '';
  return '';
}

const AvatarImage: FC<AvatarImageProps> = ({ userName, size }) => {
  const initials = getInitials(userName);
  return (
    <div className={`profile-image ${size}`}>
      <div className="initials" data-testid="avatar-initials">
        {initials}
      </div>
    </div>
  );
};

export default AvatarImage;
