"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCurrentWallet } from '@/hooks/use-current-wallet';
import { useCreateProfile } from '@/hooks/use-create-profile';

interface TapestryProfileModalProps {
  forceShow?: boolean;
  onClose?: () => void;
  message?: string;
}

export default function TapestryProfileModal({ forceShow, onClose, message }: TapestryProfileModalProps) {
  const { walletIsConnected, walletAddress, mainProfile, loadingMainProfile, refetchProfile } = useCurrentWallet();
  const { createProfile, loading: creatingProfile } = useCreateProfile();
  const [showModal, setShowModal] = useState(false);
  const [hasDismissed, setHasDismissed] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    // If wallet is connected, but no main profile exists after loading, show modal
    // Only auto-show if not dismissed
    if (walletIsConnected && !loadingMainProfile && !mainProfile && !hasDismissed) {
      setShowModal(true);
    } else if (forceShow) {
      setShowModal(true);
    } else {
      setShowModal(false);
    }
  }, [walletIsConnected, loadingMainProfile, mainProfile, hasDismissed, forceShow]);

  const handleClose = () => {
    setShowModal(false);
    setHasDismissed(true);
    if (onClose) onClose();
  };

  const handleCreate = async () => {
    if (!username || !walletAddress) return;
    try {
      await createProfile({
        walletAddress: walletAddress,
        username,
        bio,
        image: imageUrl || null
      });
      // Close modal immediately for better UX
      setHasDismissed(true);
      setShowModal(false);
      if (onClose) onClose();

      // Tapestry indexing can take a moment, so we wait 2 seconds before refetching
      setTimeout(() => {
        window.dispatchEvent(new Event('profile_updated'));
      }, 2000);
      
    } catch (err) {
      console.error('Error creating profile:', err);
    }
  };

  if (!walletIsConnected) return null;

  return (
    <>
      {showModal && !mainProfile && !loadingMainProfile && (
        <div className="fixed inset-0 z-[9999] w-screen h-screen bg-black/40 backdrop-blur-lg flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-green-950 to-black p-8 rounded-3xl border border-green-500/20 shadow-2xl w-full max-w-sm relative flex flex-col max-h-[90vh] overflow-y-auto my-auto shrink-0 custom-scrollbar">
            {/* Close Button Icon */}
            <button 
              onClick={handleClose}
              className="absolute top-4 right-4 text-white/30 hover:text-white/80 transition-colors p-2 hover:bg-white/5 rounded-full z-[20]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />
            
            <div className="relative z-10 w-full">
              <div className="flex justify-center mb-3">
                 <span className="text-5xl drop-shadow-lg">🎴</span>
              </div>
              <h2 className="text-2xl font-extrabold text-white text-center mb-2 bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">Player Profile</h2>
              <p className="text-green-100/60 text-sm text-center mb-4">
                {message || "Create your Tapestry profile to track stats."}
              </p>
              
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-black/50 text-white rounded-xl px-4 py-3 border border-green-300/40 focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none transition-all placeholder:text-white/40 font-normal shadow-inner"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Bio (optional)"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full bg-black/50 text-white rounded-xl px-4 py-3 border border-green-300/40 focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none transition-all placeholder:text-white/40 font-normal shadow-inner"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Profile Image URL (optional)"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="w-full bg-black/50 text-white rounded-xl px-4 py-3 border border-green-300/40 focus:border-green-400 focus:ring-1 focus:ring-green-400 outline-none transition-all placeholder:text-white/40 font-medium shadow-inner text-sm"
                  />
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creatingProfile || !username}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-3.5 px-4 rounded-xl disabled:opacity-50 disabled:grayscale transition-all shadow-lg shadow-green-900/50 mt-4 hover:scale-[1.02] active:scale-[0.98] border border-green-400/30"
                >
                  {creatingProfile ? 'Creating...' : 'Create Profile'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
