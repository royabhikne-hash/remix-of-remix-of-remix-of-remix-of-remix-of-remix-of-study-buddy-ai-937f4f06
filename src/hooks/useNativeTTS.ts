import { useCallback, useEffect, useState, useRef } from 'react';
import {
  isAndroidNativeTTSAvailable,
  isAndroidEnvironment,
  isWebView,
  speakWithAndroidNative,
  stopAndroidNativeTTS,
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
 * Native TTS Hook - Hybrid Fallback Chain
 * 
 * Priority (for Basic plan / Web TTS path):
 * 1. Web Speech API (speechSynthesis) — works in browser & most WebViews
 * 2. Android Native TTS (via JS bridge) — fallback when Web Speech fails in WebView
 * 
 * "No silent failure" policy: if both engines fail, returns error info.
 */

export type ActiveEngine = 'web' | 'native' | 'none';

export const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(null);
  const [useAndroidNative, setUseAndroidNative] = useState(false);
  const [activeEngine, setActiveEngine] = useState<ActiveEngine>('none');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  const isCancelledRef = useRef(false);
  const isWebViewRef = useRef(false);
  const androidNativeAvailableRef = useRef(false);
  const webSpeechAvailableRef = useRef(false);

  useEffect(() => {
    const isAndroid = isAndroidEnvironment();
    const inWebView = isWebView();
    isWebViewRef.current = inWebView || isAndroid;

    console.log(`TTS Init: Android=${isAndroid}, WebView=${inWebView}`);

    // Check Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      webSpeechAvailableRef.current = true;
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

      // WebView voice retry (voices load late)
      if (isWebViewRef.current) {
        [300, 800, 1500, 3000, 5000].forEach(delay =>
          setTimeout(() => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) setAvailableVoices(prev => prev.length === 0 ? voices : prev);
          }, delay)
        );
      }
    }

    // Check Android Native TTS bridge
    const checkNativeBridge = () => {
      if (isAndroidNativeTTSAvailable()) {
        console.log('TTS: ✅ Android Native TTS bridge detected');
        androidNativeAvailableRef.current = true;
        setUseAndroidNative(true);
        setIsSupported(true);
        return true;
      }
      return false;
    };

    if (!checkNativeBridge() && isAndroid) {
      // Bridge may be injected late - retry
      [200, 500, 1000, 2000, 3000].forEach(delay =>
        setTimeout(() => {
          if (!androidNativeAvailableRef.current && isAndroidNativeTTSAvailable()) {
            console.log(`TTS: Android native bridge found after ${delay}ms`);
            androidNativeAvailableRef.current = true;
            setUseAndroidNative(true);
            setIsSupported(true);
          }
        }, delay)
      );
    }

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  const sanitizeText = useCallback((text: string): string => sanitizeForTTS(text), []);

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
      const n = v.name.toLowerCase();
      const isHindi = v.lang === 'hi-IN' || v.lang.startsWith('hi');
      const isMale = hindiMaleNames.some(name => n.includes(name)) ||
        (!n.includes('female') && !n.includes('swara') && !n.includes('lekha'));
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

  // Speak a single chunk using Web Speech API - returns success/failure
  const speakChunkWeb = useCallback((
    text: string,
    voice: SpeechSynthesisVoice | null,
    rate: number,
    pitch: number,
    volume: number,
  ): Promise<{ completed: boolean; stoppedEarly: boolean; error?: string }> => {
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
          resolve({ completed: false, stoppedEarly: true, error: 'timeout' });
        }
      }, Math.max(15000, text.length * 100));

      utterance.onend = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        const elapsed = Date.now() - startTime;
        const stoppedEarly = text.length > 100 && elapsed < minExpectedDuration;
        if (stoppedEarly) {
          console.log(`TTS Web: Possible early stop (${elapsed}ms for ${text.length} chars)`);
        }
        resolve({ completed: true, stoppedEarly });
      };

      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimeout);
        console.error('TTS Web chunk error:', event.error);
        resolve({ completed: false, stoppedEarly: false, error: event.error });
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
          resolve({ completed: false, stoppedEarly: false, error: String(e) });
        }
      }

      // WebView: detect if speech never started
      if (isWebViewRef.current) {
        setTimeout(() => {
          if (!settled && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            console.log('TTS Web: Speech never started in WebView, marking as failed');
            settled = true;
            clearTimeout(safetyTimeout);
            resolve({ completed: false, stoppedEarly: false, error: 'webview_no_audio' });
          }
        }, 500);
      }
    });
  }, []);

  // Try Web Speech API for full text
  const tryWebSpeech = useCallback(async (
    cleanText: string, rate: number, pitch: number, volume: number, voiceName?: string | null
  ): Promise<boolean> => {
    if (!webSpeechAvailableRef.current) return false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0 && isWebViewRef.current) {
      console.log('TTS Web: No voices available in WebView');
      return false;
    }

    let voice: SpeechSynthesisVoice | null = null;
    if (voiceName) {
      voice = voices.find(v => v.name === voiceName) || null;
    }
    if (!voice) voice = getBestVoice();

    const chunkMax = isWebViewRef.current ? 900 : 2000;
    const chunks = splitIntoChunks(cleanText, chunkMax);
    chunksRef.current = chunks;
    currentChunkIndexRef.current = 0;

    console.log(`TTS Web: Starting ${chunks.length} chunks`);
    setActiveEngine('web');

    // WebView heartbeat to prevent Chrome pausing
    if (isWebViewRef.current) {
      heartbeatRef.current = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }, 8000);
    }

    let webFailed = false;
    let consecutiveEarlyStops = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (isCancelledRef.current) break;
      currentChunkIndexRef.current = i;
      const chunkText = chunks[i];

      // If too many early stops, try sub-chunking
      if (consecutiveEarlyStops >= 1 && chunkText.length > 200) {
        const subChunks = splitIntoChunks(chunkText, 200);
        for (const subChunk of subChunks) {
          if (isCancelledRef.current) break;
          const result = await speakChunkWeb(subChunk, voice, rate, pitch, volume);
          if (result.error === 'webview_no_audio') {
            webFailed = true;
            break;
          }
          if (result.stoppedEarly) {
            window.speechSynthesis.cancel();
            await new Promise(r => setTimeout(r, 100));
            await speakChunkWeb(subChunk, voice, rate, pitch, volume);
          }
          if (!isCancelledRef.current) await new Promise(r => setTimeout(r, 50));
        }
        if (webFailed) break;
      } else {
        const result = await speakChunkWeb(chunkText, voice, rate, pitch, volume);
        
        // Critical: if Web Speech produced no audio at all, abort and signal failure
        if (result.error === 'webview_no_audio' || (result.error && !result.completed && i === 0)) {
          console.log('TTS Web: Failed on first chunk, Web Speech not working');
          webFailed = true;
          break;
        }

        if (result.stoppedEarly) {
          consecutiveEarlyStops++;
          if (consecutiveEarlyStops <= 2) {
            window.speechSynthesis.cancel();
            await new Promise(r => setTimeout(r, 100));
            const subChunks = splitIntoChunks(chunkText, 200);
            for (const subChunk of subChunks) {
              if (isCancelledRef.current) break;
              await speakChunkWeb(subChunk, voice, rate, pitch, volume);
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

    // Cleanup heartbeat
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (webFailed) {
      window.speechSynthesis.cancel();
      setActiveEngine('none');
      return false;
    }

    return true;
  }, [getBestVoice, splitIntoChunks, speakChunkWeb]);

  // Try Android Native TTS
  const tryAndroidNative = useCallback(async (
    cleanText: string, rate: number
  ): Promise<boolean> => {
    if (!androidNativeAvailableRef.current || !isAndroidNativeTTSAvailable()) {
      return false;
    }

    console.log('TTS: 📱 Using Android Native Engine (fallback)');
    setActiveEngine('native');

    const detectedLang = detectLanguage(cleanText);
    const chunks = splitForNativeTTS(cleanText, 1500);
    console.log(`TTS Native: ${chunks.length} chunks, lang=${detectedLang}`);

    for (let i = 0; i < chunks.length; i++) {
      if (isCancelledRef.current) break;
      const chunkLang = detectLanguage(chunks[i]);
      const result = await speakWithAndroidNative(chunks[i], rate, chunkLang);
      if (!result.success) {
        console.error(`TTS Native: Chunk ${i + 1} failed:`, result.error);
        return false;
      }
      if (i < chunks.length - 1 && !isCancelledRef.current) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    return true;
  }, []);

  // ============= MAIN SPEAK FUNCTION =============
  // In Android WebView/APK: Android Native TTS FIRST → Web Speech fallback
  // In Browser: Web Speech API first → Android Native fallback
  const speak = useCallback((options: TTSOptions): Promise<{ success: boolean; engine: ActiveEngine; error?: string }> => {
    const { text, rate = 0.9, pitch = 1.0, volume = 1.0, voiceName } = options;

    return (async () => {
      if (!isSupported) {
        return { success: false, engine: 'none' as ActiveEngine, error: 'TTS not supported on this device' };
      }

      const cleanText = sanitizeText(text);
      if (!cleanText) {
        return { success: true, engine: 'none' as ActiveEngine };
      }

      // Cancel any ongoing speech
      stop();
      isCancelledRef.current = false;
      await new Promise(r => setTimeout(r, isWebViewRef.current ? 140 : 60));

      setIsSpeaking(true);

      try {
        // === Android WebView/APK: Try Native FIRST (more reliable in WebView) ===
        if (isWebViewRef.current && androidNativeAvailableRef.current) {
          console.log('TTS: Android WebView detected → trying Native TTS first');
          const nativeSuccess = await tryAndroidNative(cleanText, rate);
          if (nativeSuccess && !isCancelledRef.current) {
            return { success: true, engine: 'native' as ActiveEngine };
          }
          if (isCancelledRef.current) {
            return { success: false, engine: 'none' as ActiveEngine };
          }
          // Native failed, fall through to Web Speech
          console.log('TTS: Native failed in WebView, trying Web Speech...');
        }

        // === Try Web Speech API ===
        if (webSpeechAvailableRef.current) {
          const webSuccess = await tryWebSpeech(cleanText, rate, pitch, volume, voiceName || selectedVoiceName);
          if (webSuccess && !isCancelledRef.current) {
            return { success: true, engine: 'web' as ActiveEngine };
          }
          if (isCancelledRef.current) {
            return { success: false, engine: 'none' as ActiveEngine };
          }
        }

        // === Try Android Native (if not already tried above) ===
        if (!isWebViewRef.current && androidNativeAvailableRef.current) {
          console.log('TTS: Web Speech failed, trying Android Native...');
          const nativeSuccess = await tryAndroidNative(cleanText, rate);
          if (nativeSuccess) {
            return { success: true, engine: 'native' as ActiveEngine };
          }
        }

        // === ALL FAILED — No silent failure ===
        console.error('TTS: ❌ ALL engines failed! No audio output.');
        setActiveEngine('none');
        return {
          success: false,
          engine: 'none' as ActiveEngine,
          error: 'Voice playback failed on all engines. Device may not support TTS.'
        };
      } finally {
        setIsSpeaking(false);
        utteranceRef.current = null;
      }
    })();
  }, [isSupported, sanitizeText, selectedVoiceName, tryWebSpeech, tryAndroidNative]);

  const stop = useCallback(() => {
    isCancelledRef.current = true;
    stopAndroidNativeTTS();
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
    setActiveEngine('none');
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
    isNative: useAndroidNative,
    availableVoices,
    sanitizeText,
    selectedVoiceName,
    setSelectedVoiceName,
    getHindiVoices,
    useAndroidNative,
    activeEngine,
  };
};

export default useNativeTTS;
