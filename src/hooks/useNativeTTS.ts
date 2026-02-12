import { useCallback, useEffect, useState, useRef } from 'react';
import {
  isAndroidNativeTTSAvailable,
  isAndroidEnvironment,
  isWebView,
  speakWithAndroidNative,
  stopAndroidNativeTTS,
  isAndroidNativeSpeaking,
  sanitizeForTTS,
  detectLanguage,
  splitForNativeTTS,
} from '@/lib/androidTTSBridge';

interface TTSOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceName?: string;
}

/**
 * Native TTS Hook - Android Native First, Web Speech API Fallback
 * 
 * Priority:
 * 1. Android Native TTS (via JS bridge) - offline, free, low battery
 * 2. Web Speech API - browser fallback with chunking & Chrome bug workarounds
 */
export const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [useAndroidNative, setUseAndroidNative] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  const isCancelledRef = useRef(false);
  const isWebViewRef = useRef(false);
  const androidNativeRef = useRef(false);

  useEffect(() => {
    // Check Android native TTS first
    const checkAndroidNative = () => {
      const hasNative = isAndroidNativeTTSAvailable();
      const isAndroid = isAndroidEnvironment();
      const inWebView = isWebView();
      
      console.log(`TTS: Android=${isAndroid}, WebView=${inWebView}, NativeBridge=${hasNative}`);
      
      androidNativeRef.current = hasNative;
      isWebViewRef.current = inWebView || isAndroid;
      
      if (hasNative) {
        console.log('TTS: ✅ Android Native TTS available - will use native engine');
        setUseAndroidNative(true);
        setIsSupported(true);
        return true;
      }
      
      // Even without bridge, if Android WebView, mark it
      if (isAndroid && inWebView) {
        console.log('TTS: Android WebView detected but no native bridge - will try Web Speech API');
      }
      
      return false;
    };

    // Try immediately
    const hasNative = checkAndroidNative();
    
    // Retry for bridge availability (Android may inject it slightly late)
    if (!hasNative && isAndroidEnvironment()) {
      const retries = [200, 500, 1000, 2000, 3000];
      const timers = retries.map(delay =>
        setTimeout(() => {
          if (!androidNativeRef.current && isAndroidNativeTTSAvailable()) {
            console.log(`TTS: Android native bridge found after ${delay}ms`);
            androidNativeRef.current = true;
            setUseAndroidNative(true);
            setIsSupported(true);
          }
        }, delay)
      );
      // Cleanup timers on unmount
      const cleanup1 = () => timers.forEach(clearTimeout);
      
      // Also setup Web Speech API as fallback
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        setIsSupported(true);
        const loadVoices = () => {
          const voices = window.speechSynthesis.getVoices();
          if (voices.length > 0) {
            console.log('TTS: Web Speech loaded', voices.length, 'voices');
            setAvailableVoices(voices);
          }
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;

        // WebView voice retry
        const voiceTimers = [300, 800, 1500, 3000, 5000].map(delay =>
          setTimeout(() => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) setAvailableVoices(prev => prev.length === 0 ? voices : prev);
          }, delay)
        );
        
        return () => {
          cleanup1();
          voiceTimers.forEach(clearTimeout);
          window.speechSynthesis.cancel();
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        };
      }
      
      return cleanup1;
    }

    // Non-Android: setup Web Speech API
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.log('TTS: speechSynthesis not supported');
      return;
    }

    setIsSupported(true);
    
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      console.log('TTS: Loaded', voices.length, 'voices');
      if (voices.length > 0) setAvailableVoices(voices);
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    
    return () => {
      window.speechSynthesis.cancel();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  const sanitizeText = useCallback((text: string): string => {
    return sanitizeForTTS(text);
  }, []);

  const splitIntoChunks = useCallback((text: string, maxLength: number = 2000): string[] => {
    if (text.length <= maxLength) return [text];
    
    const sentences = text.split(/(?<=[।.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxLength) {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    return chunks.filter(c => c.trim().length > 0);
  }, []);

  const getBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = availableVoices.length > 0 
      ? availableVoices 
      : (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : []);
    
    if (voices.length === 0) return null;

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
    const hindiAny = voices.find(v => v.lang.startsWith('hi'));
    if (hindiAny) return hindiAny;
    
    const indianEnglishMale = voices.find(v => {
      const n = v.name.toLowerCase();
      return v.lang === 'en-IN' && (n.includes('ravi') || n.includes('male') || (!n.includes('female') && !n.includes('heera')));
    });
    if (indianEnglishMale) return indianEnglishMale;

    const indianEnglish = voices.find(v => v.lang === 'en-IN');
    if (indianEnglish) return indianEnglish;
    const english = voices.find(v => v.lang.startsWith('en'));
    if (english) return english;
    
    return voices[0] || null;
  }, [availableVoices]);

  // Speak a single chunk using Web Speech API
  const speakChunk = useCallback((
    text: string, 
    voice: SpeechSynthesisVoice | null, 
    rate: number, 
    pitch: number, 
    volume: number,
  ): Promise<{ completed: boolean; stoppedEarly: boolean }> => {
    return new Promise((resolve) => {
      if (isCancelledRef.current) {
        resolve({ completed: false, stoppedEarly: false });
        return;
      }

      const startTime = Date.now();
      const minExpectedDuration = 2500;

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

      let settled = false;
      const safetyTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ completed: false, stoppedEarly: true });
        }
      }, Math.max(15000, text.length * 100));

      utterance.onend = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        const elapsed = Date.now() - startTime;
        const stoppedEarly = text.length > 100 && elapsed < minExpectedDuration;
        if (stoppedEarly) {
          console.log(`TTS: Possible early stop (${elapsed}ms for ${text.length} chars)`);
        }
        resolve({ completed: true, stoppedEarly });
      };

      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        console.error('TTS chunk error:', event.error);
        resolve({ completed: false, stoppedEarly: false });
      };

      if (isWebViewRef.current) {
        window.speechSynthesis.cancel();
      }

      try {
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimeout);
          resolve({ completed: false, stoppedEarly: false });
        }
      }

      // WebView retry if speech never started
      if (isWebViewRef.current) {
        setTimeout(() => {
          if (!settled && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            try { window.speechSynthesis.speak(utterance); } catch { /* ignore */ }
          }
        }, 300);
      }
    });
  }, []);

  // ============= MAIN SPEAK FUNCTION =============
  const speak = useCallback((options: TTSOptions): Promise<void> => {
    const { text, rate = 0.9, pitch = 1.0, volume = 1.0, voiceName } = options;
    
    return new Promise(async (resolve) => {
      if (!isSupported) { resolve(); return; }

      const cleanText = sanitizeText(text);
      if (!cleanText) { resolve(); return; }

      // Cancel any ongoing speech
      stop();
      isCancelledRef.current = false;

      // Small delay to ensure cancel completes
      await new Promise(r => setTimeout(r, isWebViewRef.current ? 140 : 60));

      // ===== ANDROID NATIVE TTS =====
      if (androidNativeRef.current && isAndroidNativeTTSAvailable()) {
        console.log('TTS: 🤖 Using Android Native Engine');
        setIsSpeaking(true);
        
        try {
          const detectedLang = detectLanguage(cleanText);
          const chunks = splitForNativeTTS(cleanText, 800);
          
          console.log(`TTS Native: ${chunks.length} chunks, lang=${detectedLang}, speed=${rate}`);
          
          for (let i = 0; i < chunks.length; i++) {
            if (isCancelledRef.current) break;
            
            const chunkLang = detectLanguage(chunks[i]);
            const result = await speakWithAndroidNative(chunks[i], rate, chunkLang);
            
            if (!result.success) {
              console.warn(`TTS Native: Chunk ${i + 1} failed, falling back to Web Speech`);
              // Fallback to Web Speech for remaining chunks
              break;
            }
            
            // Small gap between chunks
            if (i < chunks.length - 1 && !isCancelledRef.current) {
              await new Promise(r => setTimeout(r, 50));
            }
          }
        } catch (error) {
          console.error('TTS Native: Error:', error);
        } finally {
          setIsSpeaking(false);
          resolve();
        }
        return;
      }

      // ===== WEB SPEECH API FALLBACK =====
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        console.error('TTS: No speech engine available');
        resolve();
        return;
      }

      console.log('TTS: 🌐 Using Web Speech API');

      try {
        const targetVoiceName = voiceName || selectedVoiceName;
        let voice: SpeechSynthesisVoice | null = null;
        
        if (targetVoiceName) {
          const voices = window.speechSynthesis.getVoices();
          voice = voices.find(v => v.name === targetVoiceName) || null;
        }
        if (!voice) voice = getBestVoice();

        const chunkMax = isWebViewRef.current ? 900 : 5000;
        const chunks = splitIntoChunks(cleanText, chunkMax);
        chunksRef.current = chunks;
        currentChunkIndexRef.current = 0;

        console.log(`TTS Web: ${chunks.length} chunks`);
        setIsSpeaking(true);

        // WebView heartbeat
        if (isWebViewRef.current) {
          heartbeatRef.current = setInterval(() => {
            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
              window.speechSynthesis.pause();
              window.speechSynthesis.resume();
            }
          }, 8000);
        }

        let consecutiveEarlyStops = 0;
        
        for (let i = 0; i < chunks.length; i++) {
          if (isCancelledRef.current) break;
          currentChunkIndexRef.current = i;
          const chunkText = chunks[i];
          
          if (consecutiveEarlyStops >= 1 && chunkText.length > 200) {
            const subChunks = splitIntoChunks(chunkText, 200);
            for (const subChunk of subChunks) {
              if (isCancelledRef.current) break;
              const result = await speakChunk(subChunk, voice, rate, pitch, volume);
              if (result.stoppedEarly) {
                window.speechSynthesis.cancel();
                await new Promise(r => setTimeout(r, 100));
                await speakChunk(subChunk, voice, rate, pitch, volume);
              }
              if (!isCancelledRef.current) await new Promise(r => setTimeout(r, 50));
            }
          } else {
            const result = await speakChunk(chunkText, voice, rate, pitch, volume);
            if (result.stoppedEarly) {
              consecutiveEarlyStops++;
              if (consecutiveEarlyStops <= 2) {
                window.speechSynthesis.cancel();
                await new Promise(r => setTimeout(r, 100));
                const subChunks = splitIntoChunks(chunkText, 200);
                for (const subChunk of subChunks) {
                  if (isCancelledRef.current) break;
                  await speakChunk(subChunk, voice, rate, pitch, volume);
                  await new Promise(r => setTimeout(r, 50));
                }
              }
            } else {
              consecutiveEarlyStops = 0;
            }
          }
          
          if (i < chunks.length - 1 && !isCancelledRef.current) {
            await new Promise(r => setTimeout(r, 30));
          }
        }
      } catch (error) {
        console.error('TTS Web: Exception:', error);
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
    
    // Stop Android native TTS
    stopAndroidNativeTTS();
    
    // Stop Web Speech API
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
      : (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : []);
    
    return voices.filter(v => 
      v.lang.startsWith('hi') || v.lang === 'en-IN' || v.lang.startsWith('en')
    );
  }, [availableVoices]);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    isNative: useAndroidNative, // true when using Android native engine
    availableVoices,
    sanitizeText,
    selectedVoiceName,
    setSelectedVoiceName,
    getHindiVoices,
    useAndroidNative,
  };
};

export default useNativeTTS;
