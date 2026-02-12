/**
 * Android Native TTS Bridge
 * 
 * Communicates with Android's native TextToSpeech engine via JavaScript interface.
 * When running inside an Android WebView (Appilix, Capacitor, etc.), the Android app
 * exposes a `AndroidTTS` object on `window` that we can call directly.
 * 
 * Benefits over Web Speech API:
 * - Works offline (uses device's built-in TTS engine)
 * - Better Hindi/English pronunciation
 * - Lower memory & battery usage
 * - No cloud API costs
 * 
 * Fallback: If native bridge is not available, returns false so caller can use Web Speech API.
 */

// Extend Window to include the Android TTS bridge
declare global {
  interface Window {
    AndroidTTS?: {
      speak: (text: string, locale: string, speed: number) => void;
      stop: () => void;
      isSpeaking: () => boolean;
      isAvailable: () => boolean;
      setLanguage: (locale: string) => boolean;
    };
    // Callback from Android when speech completes
    onAndroidTTSDone?: () => void;
    onAndroidTTSError?: (error: string) => void;
    onAndroidTTSStart?: () => void;
  }
}

/**
 * Detect if running inside an Android WebView with TTS bridge
 */
export const isAndroidNativeTTSAvailable = (): boolean => {
  try {
    return !!(window.AndroidTTS && typeof window.AndroidTTS.speak === 'function');
  } catch {
    return false;
  }
};

/**
 * Detect if running inside any Android environment (WebView, Appilix, etc.)
 */
export const isAndroidEnvironment = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    return /Android/i.test(ua);
  } catch {
    return false;
  }
};

/**
 * Detect if running inside a WebView (not a regular browser)
 */
export const isWebView = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    // Android WebView patterns
    const isAndroidWV = /;\s*wv\)/.test(ua) || /\bwv\b/.test(ua) || 
      (/Android/.test(ua) && /Version\/[0-9.]+/.test(ua) && /Chrome\/[0-9.]+/.test(ua));
    // Appilix pattern
    const isAppilix = /Appilix/i.test(ua);
    return isAndroidWV || isAppilix;
  } catch {
    return false;
  }
};

/**
 * Auto-detect language from text content
 * Returns 'hi-IN' for Hindi, 'en-IN' for English
 */
export const detectLanguage = (text: string): string => {
  if (!text) return 'hi-IN';
  
  // Count Devanagari characters (Hindi)
  const hindiChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  // Count Latin characters (English)  
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  
  const totalRelevant = hindiChars + englishChars;
  if (totalRelevant === 0) return 'hi-IN'; // default
  
  const hindiRatio = hindiChars / totalRelevant;
  
  // If more than 30% Hindi characters, use Hindi locale
  // This handles Hinglish (Hindi written in English) gracefully
  return hindiRatio > 0.3 ? 'hi-IN' : 'en-IN';
};

/**
 * Sanitize text for TTS - remove markdown, emojis, etc.
 */
export const sanitizeForTTS = (text: string): string => {
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
};

/**
 * Split text into chunks for native TTS (prevents buffer overflow)
 * Android TTS handles smaller chunks more reliably
 */
export const splitForNativeTTS = (text: string, maxLength: number = 1500): string[] => {
  if (text.length <= maxLength) return [text];
  
  const sentences = text.split(/(?<=[।.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length <= maxLength) {
      current += (current ? ' ' : '') + sentence;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  
  return chunks.filter(c => c.trim().length > 0);
};

export interface NativeTTSResult {
  success: boolean;
  usedNative: boolean;
  error?: string;
}

/**
 * Speak using Android native TTS bridge
 * Returns a promise that resolves when speech completes
 */
export const speakWithAndroidNative = (
  text: string, 
  speed: number = 1.0,
  locale?: string
): Promise<NativeTTSResult> => {
  return new Promise((resolve) => {
    if (!isAndroidNativeTTSAvailable()) {
      resolve({ success: false, usedNative: false, error: 'Native TTS not available' });
      return;
    }

    const cleanText = sanitizeForTTS(text);
    if (!cleanText) {
      resolve({ success: true, usedNative: true });
      return;
    }

    const detectedLocale = locale || detectLanguage(cleanText);
    const safeSpeed = Math.max(0.5, Math.min(2.0, speed));

    // Set up callbacks
    window.onAndroidTTSDone = () => {
      window.onAndroidTTSDone = undefined;
      window.onAndroidTTSError = undefined;
      resolve({ success: true, usedNative: true });
    };

    window.onAndroidTTSError = (error: string) => {
      window.onAndroidTTSDone = undefined;
      window.onAndroidTTSError = undefined;
      console.error('Android TTS Error:', error);
      resolve({ success: false, usedNative: true, error });
    };

    window.onAndroidTTSStart = () => {
      console.log('Android TTS: Speaking started');
    };

    try {
      window.AndroidTTS!.speak(cleanText, detectedLocale, safeSpeed);
      
      // Safety timeout - if no callback after generous time, resolve anyway
      const timeout = Math.max(30000, cleanText.length * 80);
      setTimeout(() => {
        if (window.onAndroidTTSDone) {
          window.onAndroidTTSDone = undefined;
          window.onAndroidTTSError = undefined;
          resolve({ success: true, usedNative: true });
        }
      }, timeout);
    } catch (e) {
      console.error('Android TTS: speak() failed:', e);
      resolve({ success: false, usedNative: true, error: String(e) });
    }
  });
};

/**
 * Stop Android native TTS
 */
export const stopAndroidNativeTTS = (): void => {
  try {
    if (isAndroidNativeTTSAvailable()) {
      window.AndroidTTS!.stop();
    }
    window.onAndroidTTSDone = undefined;
    window.onAndroidTTSError = undefined;
  } catch (e) {
    console.error('Android TTS: stop() failed:', e);
  }
};

/**
 * Check if Android native TTS is currently speaking
 */
export const isAndroidNativeSpeaking = (): boolean => {
  try {
    if (isAndroidNativeTTSAvailable()) {
      return window.AndroidTTS!.isSpeaking();
    }
  } catch { /* ignore */ }
  return false;
};
