import { useCallback, useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNativeTTS } from './useNativeTTS';

/**
 * Unified TTS Hook with Subscription-Aware Logic
 * 
 * Plan-based access:
 * - Basic Plan: Web TTS only (unlimited)
 * - Pro Plan: Premium Speechify TTS with 150,000 chars/month
 *   - Auto-fallback to Web TTS when limit reached
 * 
 * Features:
 * - Automatic plan detection
 * - Usage tracking for Pro users
 * - Seamless fallback to Web TTS
 */

export interface SmartTTSOptions {
  text: string;
  voiceId?: string;
  speed?: number;
  language?: string;
}

export interface TTSUsageInfo {
  plan: 'basic' | 'pro';
  ttsUsed: number;
  ttsLimit: number;
  ttsRemaining: number;
  canUsePremium: boolean;
  usingPremium: boolean;
}

interface SmartTTSState {
  isSpeaking: boolean;
  isLoading: boolean;
  error: string | null;
  currentVoiceId: string;
  usageInfo: TTSUsageInfo | null;
}

// Speechify voice options
export interface SpeechifyVoice {
  id: string;
  name: string;
  language: string;
  languageCode: string;
  gender: 'male' | 'female' | 'neutral';
  description?: string;
}

export const SPEECHIFY_VOICES: SpeechifyVoice[] = [
  { id: 'henry', name: 'Henry 🇮🇳', language: 'Hindi/English (India)', languageCode: 'hi-IN', gender: 'male', description: 'Indian accent, Hindi/Hinglish के लिए best' },
  { id: 'natasha', name: 'Natasha 🇮🇳', language: 'Hindi/English (India)', languageCode: 'hi-IN', gender: 'female', description: 'Indian female voice, natural Hindi pronunciation' },
  { id: 'george', name: 'George', language: 'English (UK)', languageCode: 'en-GB', gender: 'male', description: 'British accent, professional' },
  { id: 'cliff', name: 'Cliff', language: 'English (US)', languageCode: 'en-US', gender: 'male', description: 'American accent, clear' },
  { id: 'mrbeast', name: 'MrBeast', language: 'English', languageCode: 'en-US', gender: 'male', description: 'Energetic, fun' },
  { id: 'gwyneth', name: 'Gwyneth', language: 'English', languageCode: 'en-US', gender: 'female', description: 'Calm, professional' },
  { id: 'oliver', name: 'Oliver', language: 'English (UK)', languageCode: 'en-GB', gender: 'male', description: 'British, formal' },
];

// Audio cache for client-side repeated playback
const clientAudioCache = new Map<string, string>();

export const useSmartTTS = (studentId: string | null) => {
  const [state, setState] = useState<SmartTTSState>({
    isSpeaking: false,
    isLoading: false,
    error: null,
    currentVoiceId: 'henry',
    usageInfo: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Native TTS as fallback
  const nativeTTS = useNativeTTS();

  // Fetch subscription status on mount
  const fetchUsageInfo = useCallback(async () => {
    if (!studentId) return;

    try {
      const { data, error } = await supabase.functions.invoke('manage-subscription', {
        body: {
          action: 'get_subscription',
          studentId,
        },
      });

      if (error || data?.error) {
        console.log('TTS: Could not fetch subscription, defaulting to basic');
        setState(prev => ({
          ...prev,
          usageInfo: {
            plan: 'basic',
            ttsUsed: 0,
            ttsLimit: 150000,
            ttsRemaining: 150000,
            canUsePremium: false,
            usingPremium: false,
          },
        }));
        return;
      }

      const sub = data?.subscription;
      const plan = sub?.plan || 'basic';
      const ttsUsed = sub?.tts_used || 0;
      const ttsLimit = sub?.tts_limit || 150000;
      const isActive = sub?.is_active ?? true;
      const isExpired = sub?.end_date && new Date(sub.end_date) < new Date();
      
      const canUsePremium = plan === 'pro' && isActive && !isExpired && ttsUsed < ttsLimit;

      setState(prev => ({
        ...prev,
        usageInfo: {
          plan,
          ttsUsed,
          ttsLimit,
          ttsRemaining: Math.max(0, ttsLimit - ttsUsed),
          canUsePremium,
          usingPremium: canUsePremium,
        },
      }));
    } catch (err) {
      console.error('TTS: Error fetching usage info', err);
    }
  }, [studentId]);

  useEffect(() => {
    fetchUsageInfo();
  }, [fetchUsageInfo]);

  // Cleanup audio element
  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Stop ALL speech - both premium and web TTS
  const stop = useCallback(() => {
    cleanupAudio();
    nativeTTS.stop();
    // Also cancel any browser speechSynthesis directly to be safe
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState(prev => ({ ...prev, isSpeaking: false, isLoading: false }));
  }, [cleanupAudio, nativeTTS]);

  // Speak using Premium TTS (Speechify)
  const speakPremium = useCallback(async (options: SmartTTSOptions): Promise<boolean> => {
    const { text, voiceId = state.currentVoiceId, speed = 1.0, language = 'hi-IN' } = options;

    // CRITICAL: Stop any native/web TTS before starting premium
    nativeTTS.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Check cache first
    const cacheKey = `${voiceId}:${text.substring(0, 200)}`;
    const cachedAudio = clientAudioCache.get(cacheKey);
    
    // Clear corrupted cache entries
    if (cachedAudio && cachedAudio.includes('audio_data')) {
      clientAudioCache.delete(cacheKey);
    }

    try {
      let audioDataUrl: string;

      const validCachedAudio = clientAudioCache.get(cacheKey);
      if (validCachedAudio) {
        console.log('TTS: Using client cache (Premium)');
        audioDataUrl = validCachedAudio;
      } else {
        abortControllerRef.current = new AbortController();

        console.log('TTS: Calling Premium TTS...');
        
        const { data, error } = await supabase.functions.invoke('text-to-speech', {
          body: { 
            text, 
            voiceId, 
            speed, 
            language: 'hi-IN', // Always use hi-IN for Indian accent
            studentId, // Pass for usage tracking
          },
        });

        if (error) throw new Error(error.message || 'TTS request failed');
        
        // Handle FALLBACK_TO_WEB_TTS signal from server
        if (data?.error === 'FALLBACK_TO_WEB_TTS') {
          console.log('TTS: Server says fallback to Web TTS -', data.reason);
          // Update usage info from response
          if (data?.usageInfo) {
            setState(prev => ({
              ...prev,
              usageInfo: {
                ...prev.usageInfo!,
                ...data.usageInfo,
                usingPremium: false,
              },
            }));
          }
          return false; // Signal to use web TTS instead
        }
        
        if (data?.error) throw new Error(data.error);
        if (!data?.audio) throw new Error('No audio data received');

        audioDataUrl = `data:audio/mp3;base64,${data.audio}`;

        // Update usage info from response
        if (data?.usageInfo) {
          setState(prev => ({
            ...prev,
            usageInfo: {
              ...prev.usageInfo!,
              ttsUsed: data.usageInfo.ttsUsed,
              ttsRemaining: data.usageInfo.ttsRemaining,
              canUsePremium: data.usageInfo.canUsePremium,
            },
          }));
        }

        // Cache for future use
        if (clientAudioCache.size > 50) {
          const firstKey = clientAudioCache.keys().next().value;
          if (firstKey) clientAudioCache.delete(firstKey);
        }
        clientAudioCache.set(cacheKey, audioDataUrl);

        console.log(`TTS Premium: ${data.audioSize || 'unknown'} bytes, cached: ${data.cached}`);
      }

      // CRITICAL: Stop native TTS again right before playing premium audio
      nativeTTS.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      // Create and play audio
      const audio = new Audio(audioDataUrl);
      audioRef.current = audio;
      audio.playbackRate = Math.max(0.5, Math.min(2.0, speed));

      return new Promise((resolve) => {
        audio.onplay = () => {
          setState(prev => ({ ...prev, isSpeaking: true, isLoading: false }));
        };

        audio.onended = () => {
          setState(prev => ({ ...prev, isSpeaking: false }));
          cleanupAudio();
          resolve(true);
        };

        audio.onerror = () => {
          setState(prev => ({ ...prev, isSpeaking: false, isLoading: false }));
          cleanupAudio();
          resolve(false);
        };

        audio.play().catch(() => resolve(false));
      });
    } catch (error: any) {
      console.error('Premium TTS Error:', error);
      return false;
    }
  }, [state.currentVoiceId, studentId, cleanupAudio, nativeTTS]);

  // Speak using Web TTS (Native browser)
  const speakWeb = useCallback(async (options: SmartTTSOptions): Promise<boolean> => {
    const { text, speed = 0.9 } = options;
    
    console.log('TTS: Using Web TTS (Basic/Fallback)');
    
    // CRITICAL: Stop any premium audio before starting web TTS
    cleanupAudio();
    
    try {
      await nativeTTS.speak({
        text,
        rate: speed,
        pitch: 1.0,
        volume: 1.0,
      });
      
      setState(prev => ({ ...prev, isSpeaking: true, isLoading: false }));
      return true;
    } catch (error) {
      console.error('Web TTS Error:', error);
      return false;
    }
  }, [nativeTTS, cleanupAudio]);

  // Main speak function with smart routing
  const speak = useCallback(async (options: SmartTTSOptions): Promise<void> => {
    const { text } = options;

    if (!text || text.trim().length === 0) {
      console.log('TTS: Empty text, skipping');
      return;
    }

    // Stop any current playback
    stop();

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const textLength = text.length;
    const usageInfo = state.usageInfo;

    // Determine which TTS to use
    let usePremium = false;
    let fallbackReason = '';

    if (!studentId) {
      // No student ID - use Web TTS
      fallbackReason = 'No student ID';
    } else if (!usageInfo) {
      // No usage info yet - use Web TTS as fallback
      fallbackReason = 'Loading subscription info';
    } else if (usageInfo.plan === 'basic') {
      // Basic plan - Web TTS only
      fallbackReason = 'Basic plan - Web TTS only';
    } else if (usageInfo.plan === 'pro') {
      // Pro plan - check quota
      if (usageInfo.canUsePremium && usageInfo.ttsRemaining >= textLength) {
        usePremium = true;
        console.log(`TTS: Using Premium (${usageInfo.ttsRemaining} chars remaining)`);
      } else {
        fallbackReason = usageInfo.ttsRemaining < textLength 
          ? 'TTS limit reached - fallback to Web TTS'
          : 'Pro plan inactive or expired';
        
        // Update state to reflect limit reached
        if (usageInfo.ttsRemaining < textLength) {
          setState(prev => ({
            ...prev,
            usageInfo: {
              ...prev.usageInfo!,
              canUsePremium: false,
              usingPremium: false,
            },
          }));
        }
      }
    }

    if (fallbackReason) {
      console.log(`TTS: ${fallbackReason}`);
    }

    // Execute TTS
    let success = false;

    if (usePremium) {
      success = await speakPremium(options);
      
      // If premium fails, fallback to Web TTS
      if (!success) {
        console.log('TTS: Premium failed, falling back to Web TTS');
        success = await speakWeb(options);
      }
    } else {
      // Use Web TTS
      success = await speakWeb(options);
    }

    if (!success) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'TTS failed',
      }));
    }
  }, [state.usageInfo, studentId, stop, speakPremium, speakWeb]);

  // Set voice
  const setVoice = useCallback((voiceId: string) => {
    setState(prev => ({ ...prev, currentVoiceId: voiceId }));
  }, []);

  // Preview voice
  const previewVoice = useCallback(async (voiceId: string) => {
    const previewText = "नमस्ते! मैं आपका Study Buddy हूं।";
    await speak({ text: previewText, voiceId, language: 'hi-IN' });
  }, [speak]);

  // Refresh usage info (call after subscription changes)
  const refreshUsageInfo = useCallback(() => {
    fetchUsageInfo();
  }, [fetchUsageInfo]);

  // Get status message for UI
  const getStatusMessage = useCallback((): string | null => {
    if (!state.usageInfo) return null;
    
    const { plan, ttsRemaining, canUsePremium } = state.usageInfo;
    
    if (plan === 'basic') {
      return 'Using Web Voice (Basic Plan)';
    }
    
    if (plan === 'pro' && !canUsePremium) {
      return '⚠️ Voice limit reached - Using Web Voice';
    }
    
    if (plan === 'pro' && ttsRemaining < 10000) {
      return `⚠️ Low voice quota: ${Math.round(ttsRemaining / 1000)}K chars left`;
    }
    
    return null;
  }, [state.usageInfo]);

  // Sync with native TTS speaking state
  useEffect(() => {
    if (nativeTTS.isSpeaking) {
      setState(prev => ({ ...prev, isSpeaking: true }));
    } else if (!audioRef.current) {
      setState(prev => ({ ...prev, isSpeaking: false }));
    }
  }, [nativeTTS.isSpeaking]);

  return {
    speak,
    stop,
    isSpeaking: state.isSpeaking || nativeTTS.isSpeaking,
    isLoading: state.isLoading,
    error: state.error,
    isSupported: true, // Always supported (Web TTS as fallback)
    currentVoiceId: state.currentVoiceId,
    setVoice,
    voices: SPEECHIFY_VOICES,
    previewVoice,
    usageInfo: state.usageInfo,
    refreshUsageInfo,
    getStatusMessage,
    isPremiumActive: state.usageInfo?.usingPremium ?? false,
  };
};

export default useSmartTTS;
