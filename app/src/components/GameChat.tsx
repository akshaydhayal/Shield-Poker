"use client";

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGetProfiles } from '@/hooks/use-get-profiles';
import { useGetContentsByProfile } from '@/hooks/use-get-contents';
import { useCreateContent } from '@/hooks/use-create-content';
import { useGetComments } from '@/hooks/use-get-comments';
import { useCreateComment } from '@/hooks/use-create-comment';

interface GameChatProps {
  gameId: string;
  player1Key: string;
  isPlayer1: boolean;
  isPlayer2: boolean;
}

export default function GameChat({ gameId, player1Key, isPlayer1, isPlayer2 }: GameChatProps) {
  const { publicKey, connected } = useWallet();
  const [newMessage, setNewMessage] = useState('');
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Custom Hooks
  const { profiles: myProfiles } = useGetProfiles({ walletAddress: connected && publicKey ? publicKey.toString() : '' });
  const { profiles: p1Profiles } = useGetProfiles({ walletAddress: player1Key });
  const { fetchContents } = useGetContentsByProfile();
  const { createContent } = useCreateContent();
  const { data: messages, fetchComments, loading: loadingMessages } = useGetComments();
  const { createComment, loading: sendingMessage } = useCreateComment();

  const userProfileId = myProfiles?.[0]?.profile?.id || myProfiles?.[0]?.profile?.username || null;
  const p1ProfileId = p1Profiles?.[0]?.profile?.id || p1Profiles?.[0]?.profile?.username || null;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  useEffect(() => {
    if (connected && publicKey && (isPlayer1 || isPlayer2) && userProfileId !== null) {
      initChat();
    }
  }, [connected, publicKey, gameId, userProfileId, p1ProfileId]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (chatThreadId && isOpen) {
      fetchComments(chatThreadId); // Initial fetch when opened
      interval = setInterval(() => {
        fetchComments(chatThreadId);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [chatThreadId, isOpen, fetchComments]);

  const initChat = async () => {
    try {
      if (!userProfileId) return;

      if (!p1ProfileId && !isPlayer1) {
        // Player 1 hasn't setup profile, so no chat thread can exist
        return;
      }

      if (p1ProfileId) {
        const contents = await fetchContents(p1ProfileId);

        const thread = contents?.contents?.find((c: any) => 
          c.content?.customProperties?.find((p:any) => p.key === 'gameId' && p.value === gameId) || 
          c.customProperties?.find((p:any) => p.key === 'gameId' && p.value === gameId) ||
          c.content?.customProperties?.gameId === gameId || 
          c.customProperties?.gameId === gameId
        );

        if (thread) {
          const tId = thread.content?.id || thread.id;
          setChatThreadId(tId);
          await fetchComments(tId);
          return;
        }
      }

      // 3. If thread doesn't exist and I am Player 1, create it
      if (isPlayer1 && userProfileId && !chatThreadId) {
         const newPost = await createContent({
            profileId: userProfileId,
            content: `Chat thread for Game #${gameId}`,
            customProperties: [
              { key: 'gameId', value: gameId },
              { key: 'isChatThread', value: 'true' }
            ]
          });
        const tId = (newPost as any)?.content?.id || (newPost as any)?.id;
        if (tId) {
          setChatThreadId(tId);
          fetchComments(tId);
        }
      }

    } catch (err) {
      console.error("Error initializing chat:", err);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !chatThreadId || !userProfileId) return;

    try {
      await createComment({
        profileId: userProfileId,
        contentId: chatThreadId,
        text: newMessage.trim()
      });
      setNewMessage('');
      await fetchComments(chatThreadId);
    } catch (err) {
      console.error("Error sending message:", err);
    }
  };

  if (!connected || (!isPlayer1 && !isPlayer2) || !chatThreadId) {
    return null;
  }

  return (
    <>
      {/* Floating Chat Toggle */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform z-40 border border-purple-400/30"
        >
          <span className="text-2xl">💬</span>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-80 sm:w-96 h-[500px] bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl border border-white/10 flex flex-col z-50 overflow-hidden">
          {/* Header */}
          <div className="bg-white/5 border-b border-white/10 p-4 flex justify-between items-center bg-gradient-to-r from-purple-900/40 to-blue-900/40">
            <h3 className="font-bold text-white flex items-center gap-2">
              <span className="text-xl">💬</span> Game Chat
            </h3>
            <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white transition-colors">
              ✖
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <p className="text-white/40 text-center text-sm italic mt-10">No messages yet. Say hi!</p>
            ) : (
              messages.map((m: any) => {
                const isMe = m.author?.id === userProfileId || m.author?.username === userProfileId;
                return (
                  <div key={m.comment?.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      isMe 
                        ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-tr-sm' 
                        : 'bg-white/10 text-white/90 rounded-tl-sm border border-white/5'
                    }`}>
                      {!isMe && (
                        <p className="text-[10px] text-white/50 font-bold mb-1">{m.author?.username}</p>
                      )}
                      <p className="text-sm">{m.comment?.text}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} className="p-3 border-t border-white/10 bg-black/50">
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || sendingMessage}
                className="bg-purple-600 hover:bg-purple-500 text-white rounded-full w-10 h-10 flex items-center justify-center disabled:opacity-50 transition-colors"
              >
                {sendingMessage ? '...' : '➤'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
