import { useCallback, useEffect, useState } from 'react';

interface TTSOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

/**
 * Simple Web Speech API TTS hook
 */
export const useNativeTTS = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      setIsSupported(true);
      
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          setAvailableVoices(voices);
        }
      };
      
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const sanitizeText = useCallback((text: string): string => {
    return text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const getBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices();
    
    // Priority: Hindi > Indian English > Any English
    const hindiVoice = voices.find(v => v.lang === 'hi-IN');
    if (hindiVoice) return hindiVoice;
    
    const indianEnglish = voices.find(v => v.lang === 'en-IN');
    if (indianEnglish) return indianEnglish;
    
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) return englishVoice;
    
    return voices[0] || null;
  }, [availableVoices]);

  const speak = useCallback(async (options: TTSOptions): Promise<void> => {
    const { text, rate = 0.9, pitch = 1.0, volume = 1.0 } = options;
    
    if (!isSupported) return;

    const cleanText = sanitizeText(text);
    if (!cleanText) return;

    window.speechSynthesis.cancel();
    setIsSpeaking(true);

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voice = getBestVoice();
      
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = 'hi-IN';
      }
      
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      setIsSpeaking(false);
    }
  }, [isSupported, sanitizeText, getBestVoice]);

  const stop = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    isNative: false,
    availableVoices,
    sanitizeText,
  };
};

export default useNativeTTS;
