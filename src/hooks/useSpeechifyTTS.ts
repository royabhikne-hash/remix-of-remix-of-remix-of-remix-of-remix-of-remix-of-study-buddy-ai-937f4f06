import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Speechify voice options - these are the actual voice IDs from Speechify
export interface SpeechifyVoice {
  id: string;
  name: string;
  language: string;
  languageCode: string;
  gender: 'male' | 'female' | 'neutral';
  description?: string;
}

// Speechify system voices (shared voices available to all users)
// Note: For Hindi text, the simba-multilingual model is used automatically
export const SPEECHIFY_VOICES: SpeechifyVoice[] = [
  // Primary voices (work well with Hinglish/Hindi text via multilingual model)
  { id: 'henry', name: 'Henry', language: 'English (India)', languageCode: 'en-IN', gender: 'male', description: 'Clear male voice, great for education' },
  { id: 'george', name: 'George', language: 'English (UK)', languageCode: 'en-GB', gender: 'male', description: 'British accent, professional' },
  { id: 'cliff', name: 'Cliff', language: 'English (US)', languageCode: 'en-US', gender: 'male', description: 'American accent, clear' },
  { id: 'natasha', name: 'Natasha', language: 'English', languageCode: 'en-US', gender: 'female', description: 'Female voice, natural' },
  { id: 'mrbeast', name: 'MrBeast', language: 'English', languageCode: 'en-US', gender: 'male', description: 'Energetic, fun' },
  { id: 'snoop', name: 'Snoop', language: 'English', languageCode: 'en-US', gender: 'male', description: 'Laid-back style' },
  { id: 'gwyneth', name: 'Gwyneth', language: 'English', languageCode: 'en-US', gender: 'female', description: 'Calm, professional' },
  { id: 'oliver', name: 'Oliver', language: 'English (UK)', languageCode: 'en-GB', gender: 'male', description: 'British, formal' },
];

interface TTSOptions {
  text: string;
  voiceId?: string;
  speed?: number;
  language?: string;
}

interface TTSState {
  isSpeaking: boolean;
  isLoading: boolean;
  error: string | null;
  currentVoiceId: string;
}

// Audio cache for client-side repeated playback
const clientAudioCache = new Map<string, string>();

/**
 * Speechify TTS Hook - Server-side text-to-speech with caching and mobile support
 * Replaces browser-based Web Speech API for consistent cross-platform audio
 * 
 * Features:
 * - Server-side audio generation (works on Android, iOS, Web)
 * - Automatic Hindi/Hinglish detection with simba-multilingual model
 * - Client & server-side caching for cost optimization
 * - HTML5 audio playback with mobile-friendly controls
 */
export const useSpeechifyTTS = () => {
  const [state, setState] = useState<TTSState>({
    isSpeaking: false,
    isLoading: false,
    error: null,
    currentVoiceId: 'henry', // Default to Henry - works well with Indian content
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Stop current speech
  const stop = useCallback(() => {
    cleanupAudio();
    setState(prev => ({ ...prev, isSpeaking: false, isLoading: false }));
  }, [cleanupAudio]);

  // Main speak function
  const speak = useCallback(async (options: TTSOptions): Promise<void> => {
    const { text, voiceId = state.currentVoiceId, speed = 1.0, language = 'en-IN' } = options;

    if (!text || text.trim().length === 0) {
      console.log('TTS: Empty text, skipping');
      return;
    }

    // Stop any current playback
    stop();

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    // Check client-side cache first (first 200 chars + voice as key)
    const cacheKey = `${voiceId}:${text.substring(0, 200)}`;
    
    // Clear corrupted cache entries that might have JSON instead of audio
    const cachedAudio = clientAudioCache.get(cacheKey);
    if (cachedAudio && cachedAudio.includes('audio_data')) {
      clientAudioCache.delete(cacheKey);
    }

    try {
      let audioDataUrl: string;

      const validCachedAudio = clientAudioCache.get(cacheKey);
      if (validCachedAudio) {
        console.log('TTS: Using client cache');
        audioDataUrl = validCachedAudio;
      } else {
        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        console.log('TTS: Calling edge function...');
        
        const { data, error } = await supabase.functions.invoke('text-to-speech', {
          body: { text, voiceId, speed, language },
        });

        if (error) {
          throw new Error(error.message || 'TTS request failed');
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (!data?.audio) {
          throw new Error('No audio data received');
        }

        // Create data URL from base64 audio
        audioDataUrl = `data:audio/mp3;base64,${data.audio}`;

        // Cache for future use (limit cache size)
        if (clientAudioCache.size > 50) {
          const firstKey = clientAudioCache.keys().next().value;
          if (firstKey) clientAudioCache.delete(firstKey);
        }
        clientAudioCache.set(cacheKey, audioDataUrl);

        console.log(`TTS: Received ${data.audioSize || 'unknown'} bytes, cached: ${data.cached}, model: ${data.model || 'unknown'}`);
      }

      // Create and play audio element
      const audio = new Audio(audioDataUrl);
      audioRef.current = audio;

      // Set playback rate
      audio.playbackRate = Math.max(0.5, Math.min(2.0, speed));

      // Handle audio events
      audio.onplay = () => {
        setState(prev => ({ ...prev, isSpeaking: true, isLoading: false }));
      };

      audio.onended = () => {
        setState(prev => ({ ...prev, isSpeaking: false }));
        cleanupAudio();
      };

      audio.onerror = (e) => {
        console.error('TTS: Audio playback error', e);
        setState(prev => ({ 
          ...prev, 
          isSpeaking: false, 
          isLoading: false,
          error: 'Audio playback failed' 
        }));
        cleanupAudio();
      };

      audio.onpause = () => {
        setState(prev => ({ ...prev, isSpeaking: false }));
      };

      // Start playback
      await audio.play();

    } catch (error: any) {
      console.error('TTS Error:', error);
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        isSpeaking: false,
        error: error.message || 'TTS failed'
      }));
    }
  }, [state.currentVoiceId, stop, cleanupAudio]);

  // Set voice
  const setVoice = useCallback((voiceId: string) => {
    setState(prev => ({ ...prev, currentVoiceId: voiceId }));
  }, []);

  // Get voices for a specific language
  const getVoicesForLanguage = useCallback((lang: 'hi' | 'en' | 'all' = 'all'): SpeechifyVoice[] => {
    // All voices support Hindi via multilingual model, so return all for 'hi' as well
    return SPEECHIFY_VOICES;
  }, []);

  // Preview a voice with sample text
  const previewVoice = useCallback(async (voiceId: string) => {
    const voice = SPEECHIFY_VOICES.find(v => v.id === voiceId);
    if (!voice) return;

    // Use Hinglish preview text to test multilingual support
    const previewText = "Namaste! Main aapka Study Buddy hun. Aaj kya padhna hai?";

    await speak({ text: previewText, voiceId });
  }, [speak]);

  // Clear all cached audio
  const clearCache = useCallback(() => {
    clientAudioCache.clear();
    console.log('TTS: Client cache cleared');
  }, []);

  return {
    speak,
    stop,
    isSpeaking: state.isSpeaking,
    isLoading: state.isLoading,
    error: state.error,
    isSupported: true, // Always supported with server-side TTS
    currentVoiceId: state.currentVoiceId,
    setVoice,
    voices: SPEECHIFY_VOICES,
    getVoicesForLanguage,
    previewVoice,
    clearCache,
  };
};

export default useSpeechifyTTS;
