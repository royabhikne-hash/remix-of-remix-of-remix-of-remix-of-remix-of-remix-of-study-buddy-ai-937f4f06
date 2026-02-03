import React, { useState } from 'react';
import { Volume2, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface VoiceSelectorProps {
  voices: SpeechSynthesisVoice[];
  selectedVoice: string | null;
  onVoiceChange: (voiceName: string) => void;
  disabled?: boolean;
}

const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoice,
  onVoiceChange,
  disabled = false,
}) => {
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Filter to show Hindi and Indian English voices first, then others
  const sortedVoices = React.useMemo(() => {
    const hindiVoices = voices.filter(v => v.lang.startsWith('hi'));
    const indianEnglish = voices.filter(v => v.lang === 'en-IN');
    const otherEnglish = voices.filter(v => v.lang.startsWith('en') && v.lang !== 'en-IN');
    
    return [...hindiVoices, ...indianEnglish, ...otherEnglish];
  }, [voices]);

  const getVoiceLabel = (voice: SpeechSynthesisVoice): string => {
    const langLabels: Record<string, string> = {
      'hi-IN': '🇮🇳 Hindi',
      'hi': '🇮🇳 Hindi',
      'en-IN': '🇮🇳 English (India)',
      'en-US': '🇺🇸 English (US)',
      'en-GB': '🇬🇧 English (UK)',
    };
    
    const langLabel = langLabels[voice.lang] || voice.lang;
    return `${voice.name} - ${langLabel}`;
  };

  const previewVoice = () => {
    if (!selectedVoice || isPreviewing) {
      // Stop current preview
      window.speechSynthesis.cancel();
      setIsPreviewing(false);
      return;
    }

    const voice = sortedVoices.find(v => v.name === selectedVoice);
    if (!voice) return;

    window.speechSynthesis.cancel();
    
    const previewText = voice.lang.startsWith('hi') 
      ? "नमस्ते! मैं आपका स्टडी बडी हूं। आज क्या पढ़ना है?"
      : "Hello! I am your Study Buddy. What would you like to study today?";
    
    const utterance = new SpeechSynthesisUtterance(previewText);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    
    utterance.onstart = () => setIsPreviewing(true);
    utterance.onend = () => setIsPreviewing(false);
    utterance.onerror = () => setIsPreviewing(false);
    
    window.speechSynthesis.speak(utterance);
  };

  if (sortedVoices.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Volume2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <Select
        value={selectedVoice || undefined}
        onValueChange={onVoiceChange}
        disabled={disabled}
      >
        <SelectTrigger className="flex-1 h-8 text-xs bg-background">
          <SelectValue placeholder="Voice चुनें" />
        </SelectTrigger>
        <SelectContent className="max-h-[300px] bg-background z-50">
          {sortedVoices.map((voice) => (
            <SelectItem 
              key={voice.name} 
              value={voice.name}
              className="text-xs"
            >
              {getVoiceLabel(voice)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 flex-shrink-0"
        onClick={previewVoice}
        disabled={!selectedVoice || disabled}
        title={isPreviewing ? "Stop preview" : "Preview voice"}
      >
        {isPreviewing ? (
          <Square className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
};

export default VoiceSelector;
