"use client";

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGetProfiles } from '@/hooks/use-get-profiles';
import { useGetContent } from '@/hooks/use-get-content';
import { useCreateContent } from '@/hooks/use-create-content';
import { useGetComments } from '@/hooks/use-get-comments';
import { useCreateComment } from '@/hooks/use-create-comment';
import { getProfileImage } from './ProfileBadge';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(0);
  
  // Custom Hooks
  const { profiles: myProfiles } = useGetProfiles({ walletAddress: connected && publicKey ? publicKey.toString() : '' });
  // Removed p1Profiles dependency as we use deterministic ID
  const { fetchContent, content: chatContent } = useGetContent();
  const { createContent } = useCreateContent();
  const { data: messages, fetchComments, loading: loadingMessages } = useGetComments();
  const { createComment, loading: sendingMessage } = useCreateComment();

  const userProfileId = myProfiles?.[0]?.profile?.id || myProfiles?.[0]?.profile?.username || null;
  // Removed p1ProfileId logic

  const scrollToBottom = (force = false) => {
    if (!chatContainerRef.current || !messagesEndRef.current) {
      // Fallback if ref isn't attached yet
      if (force && messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    // If within 200px of the bottom, we consider it "at the bottom"
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 200;
    
    if (force || isAtBottom) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (messages.length !== prevMessagesLength.current) {
      const isFirstLoad = prevMessagesLength.current === 0;
      // Small timeout to allow the DOM to render the new messages before measuring
      setTimeout(() => scrollToBottom(isFirstLoad), 50);
    }
    prevMessagesLength.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (connected && publicKey && (isPlayer1 || isPlayer2) && userProfileId !== null) {
      initChat();
    }
  }, [connected, publicKey, gameId, userProfileId, isPlayer1, isPlayer2]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (chatThreadId) {
      fetchComments(chatThreadId); // Initial fetch when opened
      interval = setInterval(() => {
        fetchComments(chatThreadId);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [chatThreadId, fetchComments]);

  const initChat = async () => {
    try {
      if (!userProfileId) return;

      const threadId = `game-chat-${gameId}`;

      // 1. Try to fetch existing thread
      const existingThread = await fetchContent(threadId);
      
      if (existingThread && existingThread.content) {
         setChatThreadId(threadId);
         await fetchComments(threadId);
         return;
      }

      // 2. If no thread found (e.g. game created before this feature or creation failed),
      // and I am Player 1, try to lazy-create it.
      if (isPlayer1 && !chatThreadId) {
         try {
            const newPost = await createContent({
                profileId: userProfileId,
                id: threadId,
                content: `Chat thread for Shield Poker Game #${gameId}`,
                customProperties: [
                  { key: 'gameId', value: gameId.toString() },
                  { key: 'isChatThread', value: 'true' }
                ]
              });
            // If success
             setChatThreadId(threadId);
             await fetchComments(threadId);
         } catch (e) {
             console.error("Failed to lazy-create chat thread", e);
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
      // Force scroll to bottom when we send a message
      setTimeout(() => scrollToBottom(true), 100);
    } catch (err) {
      console.error("Error sending message:", err);
    }
  };

  if (!connected || (!isPlayer1 && !isPlayer2) || !chatThreadId) {
    return null;
  }

  return (
    <div className="w-full h-full min-h-[400px] max-h-[800px] bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white/5 border-b border-white/10 px-4 py-3 flex justify-between items-center bg-gradient-to-r from-purple-900/40 to-blue-900/40">
        <h3 className="font-bold text-white flex items-center gap-2">
          <span className="text-xl">💬</span> Game Chat
        </h3>
      </div>

          {/* Messages */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingMessages && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full space-y-3">
                <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                <p className="text-white/60 text-sm animate-pulse">Chats Loading...</p>
              </div>
            ) : messages.length === 0 ? (
              <p className="text-white/40 text-center text-sm italic mt-10">No messages yet. Say hi!</p>
            ) : (
              [...messages].reverse().map((m: any) => {
                const isMe = m.author?.id === userProfileId || m.author?.username === userProfileId;
                const avatarUrl = getProfileImage(m.author);
                const initial = (m.author?.username || m.author?.id || '?')[0].toUpperCase();

                return (
                  <div key={m.comment?.id} className={`flex items-end gap-0 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt="Avatar" 
                        className="w-8 h-8 rounded-full border border-white/10 shadow-sm flex-shrink-0"
                      />
                    ) : (
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 border border-white/10 ${
                        isMe ? 'bg-gradient-to-br from-purple-500 to-blue-500' : 'bg-gradient-to-br from-gray-600 to-gray-700'
                      }`}>
                        {initial}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                      isMe 
                        ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-br-sm' 
                        : 'bg-white/10 text-white/90 rounded-bl-sm border border-white/5'
                    }`}>
                      <p className="text-sm leading-tight">{m.comment?.text}</p>
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
  );
}
