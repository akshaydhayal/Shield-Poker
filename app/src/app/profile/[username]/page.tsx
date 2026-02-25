"use client";

import { useParams } from "next/navigation";
import { useGetProfileInfo } from "@/hooks/use-get-profile-info";
import { useCurrentWallet } from "@/hooks/use-current-wallet";
import Link from "next/link";
import { useState } from "react";
import { getProfileImage } from "@/components/ProfileBadge";

const getCustomProp = (profile: any, keyName: string) => {
  if (!profile) return "0";
  
  // Try direct property first (new Tapestry API behavior observed)
  if (profile[keyName] !== undefined && profile[keyName] !== null) {
     return profile[keyName];
  }

  if (!profile.customProperties) return "0";
  if (Array.isArray(profile.customProperties)) {
    const prop = profile.customProperties.find((p: any) => p.key === keyName);
    return prop ? prop.value : "0";
  }
  return profile.customProperties[keyName] || "0";
};

export default function ProfilePage() {
  const params = useParams();
  const username = params.username as string;
  const { profile, loading: profileLoading, error: profileError } = useGetProfileInfo({ username });
  const { walletAddress } = useCurrentWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (profile?.walletAddress) {
      try {
        await navigator.clipboard.writeText(profile.walletAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy", err);
      }
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-green-400">
        <div className="animate-spin text-5xl mb-4">🎴</div>
        <p className="font-bold text-lg animate-pulse">Loading Profile...</p>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-white text-center">
        <h1 className="text-4xl font-black text-red-500 mb-4">Profile Not Found</h1>
        <p className="text-white/60 mb-8 max-w-md">
          {profileError || "The requested Tapestry profile does not exist or has not been initialized."}
        </p>
        <Link 
          href="/"
          className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg"
        >
          Return to Game
        </Link>
      </div>
    );
  }

  const gamesPlayed = getCustomProp(profile, 'total games played');
  const gamesWon = getCustomProp(profile, 'games won');
  const gamesLost = getCustomProp(profile, 'games lost');
  const imageUrl = getProfileImage(profile);
  const hasImage = !!imageUrl;

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Background decoration */}
      <div className="fixed top-[-10%] right-[-5%] w-96 h-96 bg-green-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-5%] w-96 h-96 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none " />

      <div className="max-w-4xl mx-auto px-6 py-8 relative z-10">
        {/* Profile Card */}
        <div className="bg-gradient-to-br from-green-950 to-black rounded-3xl border border-green-500/30 shadow-2xl overflow-hidden mt-0">
          {/* Banner */}
          <div className="h-32 bg-gradient-to-r from-green-800/40 to-emerald-900/40 border-b border-green-500/20 relative">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cardboard-flat.png')] opacity-20 mix-blend-overlay"></div>
          </div>
          
          <div className="px-8 pb-8">
            <div className="flex flex-col md:flex-row gap-6 items-start md:items-end -mt-16 mb-4 relative z-10">
              {/* Avatar */}
              <div className="w-32 h-32 rounded-2xl border-4 border-black bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-xl overflow-hidden shrink-0">
                {hasImage ? (
                  <img src={imageUrl} alt={profile.username} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-5xl font-black text-black uppercase">
                    {(profile.username || 'U')[0]}
                  </span>
                )}
              </div>
              
              {/* User Info */}
              <div className="flex-1">
                <h1 className="text-4xl font-black text-white mb-1 drop-shadow-md">
                  {profile.username}
                </h1>
                <div className="flex items-center gap-2 text-white/50 bg-black/50 w-fit px-3 py-1.5 rounded-lg border border-white/5 font-mono text-sm max-w-full overflow-hidden">
                  <span className="truncate">{profile.walletAddress}</span>
                  <button onClick={handleCopy} className="hover:text-white transition-colors ml-2 cursor-pointer shrink-0">
                    {copied ? "✓ Copied" : "📋 Copy"}
                  </button>
                </div>
              </div>
            </div>

            {/* Bio section if available */}
            {(profile.bio || (getCustomProp(profile, 'bio') !== "0" && getCustomProp(profile, 'bio'))) && (
               <div className="bg-black/40 border border-green-500/10 rounded-2xl px-6 py-3 mb-6">
                 <h3 className="text-green-400 font-bold mb-2 uppercase tracking-wider text-sm flex items-center gap-2">
                   <span>📜</span> Bio
                 </h3>
                 <p className="text-white/80 leading-relaxed italic">
                    &quot;{profile.bio || getCustomProp(profile, 'bio')}&quot;
                 </p>
               </div>
            )}

            {/* Stats Grid */}
            <h3 className="text-green-400 font-bold mb-4 uppercase tracking-wider text-sm flex items-center gap-2">
              <span>🎲</span> Casino Stats
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-black to-green-950/50 border border-green-500/20 rounded-2xl p-6 flex flex-col hover:border-green-400/40 transition-colors">
                <span className="text-white/50 font-bold text-sm mb-2 uppercase">Games Played</span>
                <span className="text-4xl font-black text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.3)]">
                  {gamesPlayed}
                </span>
              </div>
              <div className="bg-gradient-to-br from-black to-emerald-950/50 border border-emerald-500/20 rounded-2xl p-6 flex flex-col hover:border-emerald-400/40 transition-colors">
                <span className="text-white/50 font-bold text-sm mb-2 uppercase">Games Won</span>
                <span className="text-4xl font-black text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]">
                  {gamesWon}
                </span>
              </div>
              <div className="bg-gradient-to-br from-black to-red-950/30 border border-red-500/20 rounded-2xl p-6 flex flex-col hover:border-red-400/40 transition-colors">
                <span className="text-white/50 font-bold text-sm mb-2 uppercase">Games Lost</span>
                <span className="text-4xl font-black text-red-400 drop-shadow-[0_0_15px_rgba(248,113,113,0.3)]">
                  {gamesLost}
                </span>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
