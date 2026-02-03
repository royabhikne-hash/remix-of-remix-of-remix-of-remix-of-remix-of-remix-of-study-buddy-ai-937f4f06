import { useCallback, useEffect, useState, useRef } from 'react';

interface TTSOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceName?: string;
}

/**
 * Robust Web Speech API TTS hook with chunking and Chrome bug workarounds
 * - Chunks long text to prevent 15-second WebView cutoff
 * - Uses pause/resume heartbeat to prevent Chrome from stopping
 * - Proper promise handling and voice selection
 */
export const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  const isCancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.log('TTS: speechSynthesis not supported');
      return;
    }

    setIsSupported(true);
    
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      console.log('TTS: Loaded', voices.length, 'voices');
      if (voices.length > 0) {
        setAvailableVoices(voices);
      }
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    
    return () => {
      window.speechSynthesis.cancel();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  const sanitizeText = useCallback((text: string): string => {
    return text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  // Split text into smaller chunks for reliable TTS
  const splitIntoChunks = useCallback((text: string, maxLength: number = 120): string[] => {
    const sentences = text.split(/(?<=[।.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxLength) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        // If single sentence is too long, split by commas
        if (sentence.length > maxLength) {
          const parts = sentence.split(/(?<=,)\s+/);
          for (const part of parts) {
            if (part.length > maxLength) {
              // Force split at word boundary
              const words = part.split(' ');
              let subChunk = '';
              for (const word of words) {
                if (subChunk.length + word.length + 1 <= maxLength) {
                  subChunk += (subChunk ? ' ' : '') + word;
                } else {
                  if (subChunk) chunks.push(subChunk);
                  subChunk = word;
                }
              }
              if (subChunk) chunks.push(subChunk);
            } else {
              chunks.push(part);
            }
          }
          currentChunk = '';
        } else {
          currentChunk = sentence;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    return chunks.filter(c => c.trim().length > 0);
  }, []);

  const getBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = availableVoices.length > 0 
      ? availableVoices 
      : window.speechSynthesis.getVoices();
    
    if (voices.length === 0) return null;

    const hindiVoices = voices.filter(v => v.lang.startsWith('hi') || v.lang === 'en-IN');
    console.log('TTS: Hindi/Indian voices:', hindiVoices.map(v => `${v.name} (${v.lang})`).join(', ') || 'None');

    const hindiMaleNames = [
      'google हिन्दी', 'google hindi', 'madhur', 'hemant', 'prabhat', 
      'microsoft madhur', 'samsung hindi male', 'hindi male', 'hindi india male', 'male hindi', 'vani'
    ];
    
    const hindiMaleVoice = voices.find(v => {
      const nameLower = v.name.toLowerCase();
      const isHindi = v.lang === 'hi-IN' || v.lang.startsWith('hi');
      const isMale = hindiMaleNames.some(name => nameLower.includes(name)) || 
                     (!nameLower.includes('female') && !nameLower.includes('swara') && !nameLower.includes('lekha'));
      return isHindi && isMale;
    });
    
    if (hindiMaleVoice) return hindiMaleVoice;

    const hindiVoice = voices.find(v => v.lang === 'hi-IN');
    if (hindiVoice) return hindiVoice;

    const hindiAnyLocale = voices.find(v => v.lang.startsWith('hi'));
    if (hindiAnyLocale) return hindiAnyLocale;
    
    const indianEnglishMale = voices.find(v => {
      const nameLower = v.name.toLowerCase();
      return v.lang === 'en-IN' && 
             (nameLower.includes('ravi') || nameLower.includes('male') || 
              (!nameLower.includes('female') && !nameLower.includes('heera')));
    });
    if (indianEnglishMale) return indianEnglishMale;

    const indianEnglish = voices.find(v => v.lang === 'en-IN');
    if (indianEnglish) return indianEnglish;
    
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) return englishVoice;
    
    return voices[0] || null;
  }, [availableVoices]);

  // Speak a single chunk
  const speakChunk = useCallback((text: string, voice: SpeechSynthesisVoice | null, rate: number, pitch: number, volume: number): Promise<void> => {
    return new Promise((resolve) => {
      if (isCancelledRef.current) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = 'hi-IN';
      }
      
      utterance.rate = Math.max(0.1, Math.min(10, rate));
      utterance.pitch = Math.max(0, Math.min(2, pitch));
      utterance.volume = Math.max(0, Math.min(1, volume));

      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('TTS chunk error:', event.error);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const speak = useCallback((options: TTSOptions): Promise<void> => {
    const { text, rate = 0.9, pitch = 1.0, volume = 1.0, voiceName } = options;
    
    return new Promise(async (resolve) => {
      if (!isSupported) {
        resolve();
        return;
      }

      const cleanText = sanitizeText(text);
      if (!cleanText) {
        resolve();
        return;
      }

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      
      isCancelledRef.current = false;
      
      // Small delay to ensure cancel completes
      await new Promise(r => setTimeout(r, 50));

      try {
        // Get voice
        const targetVoiceName = voiceName || selectedVoiceName;
        let voice: SpeechSynthesisVoice | null = null;
        
        if (targetVoiceName) {
          const voices = window.speechSynthesis.getVoices();
          voice = voices.find(v => v.name === targetVoiceName) || null;
        }
        
        if (!voice) {
          voice = getBestVoice();
        }

        // Split into chunks for reliable playback
        const chunks = splitIntoChunks(cleanText, 120);
        chunksRef.current = chunks;
        currentChunkIndexRef.current = 0;

        console.log(`TTS: Speaking ${chunks.length} chunks`);
        setIsSpeaking(true);

        // Start heartbeat to prevent Chrome from stopping (every 8 seconds)
        heartbeatRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, 8000);

        // Speak each chunk sequentially
        for (let i = 0; i < chunks.length; i++) {
          if (isCancelledRef.current) break;
          
          currentChunkIndexRef.current = i;
          await speakChunk(chunks[i], voice, rate, pitch, volume);
          
          // Small gap between chunks for natural flow
          if (i < chunks.length - 1 && !isCancelledRef.current) {
            await new Promise(r => setTimeout(r, 100));
          }
        }

      } catch (error) {
        console.error('TTS: Exception during speak:', error);
      } finally {
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        setIsSpeaking(false);
        utteranceRef.current = null;
        resolve();
      }
    });
  }, [isSupported, sanitizeText, getBestVoice, selectedVoiceName, splitIntoChunks, speakChunk]);

  const stop = useCallback(() => {
    isCancelledRef.current = true;
    
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    
    utteranceRef.current = null;
    chunksRef.current = [];
    currentChunkIndexRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const getHindiVoices = useCallback((): SpeechSynthesisVoice[] => {
    const voices = availableVoices.length > 0 
      ? availableVoices 
      : window.speechSynthesis.getVoices();
    
    return voices.filter(v => 
      v.lang.startsWith('hi') || 
      v.lang === 'en-IN' || 
      v.lang.startsWith('en')
    );
  }, [availableVoices]);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    isNative: false,
    availableVoices,
    sanitizeText,
    selectedVoiceName,
    setSelectedVoiceName,
    getHindiVoices,
  };
};

export default useNativeTTS;
