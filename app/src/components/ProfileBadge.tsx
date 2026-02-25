"use client";

import Link from 'next/link';
import { useCurrentWallet } from '@/hooks/use-current-wallet';

export const getProfileImage = (profile: any) => {
  if (!profile) return null;
  if (profile.image && profile.image !== "0") return profile.image;
  
  if (profile.customProperties) {
    if (Array.isArray(profile.customProperties)) {
      const prop = profile.customProperties.find((p: any) => p.key === 'profileImage' || p.key === 'image');
      return prop && prop.value !== "0" ? prop.value : null;
    }
    const val = profile.customProperties.profileImage || profile.customProperties.image;
    return val && val !== "0" ? val : null;
  }
  return null;
};

export default function ProfileBadge() {
  const { mainProfile } = useCurrentWallet();

  if (!mainProfile) return null;

  const imageUrl = getProfileImage(mainProfile);

  return (
    <Link href={`/profile/${mainProfile.username}`}>
      <div className="flex items-center gap-2 bg-gradient-to-r from-green-900/60 to-emerald-900/60 px-4 py-1.5 rounded-full border border-green-500/30 shadow-lg hover:border-green-400/50 transition-colors cursor-pointer group">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt="Profile" 
            className="w-7 h-7 rounded-full object-cover shadow-sm ring-1 ring-green-400/50"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-400 to-emerald-400 flex items-center justify-center text-xs font-bold text-black uppercase shadow-sm">
            {(mainProfile.username || 'U')[0]}
          </div>
        )}
        <span className="text-white text-sm font-bold truncate max-w-[100px] group-hover:text-green-300 transition-colors hidden md:inline">
          {mainProfile.username}
        </span>
      </div>
    </Link>
  );
}
