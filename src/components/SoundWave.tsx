import { cn } from "@/lib/utils";

interface SoundWaveProps {
  isActive: boolean;
  className?: string;
}

const SoundWave = ({ isActive, className }: SoundWaveProps) => {
  if (!isActive) return null;
  
  return (
    <div className={cn("flex items-center gap-0.5 h-4", className)}>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-primary rounded-full animate-sound-wave"
          style={{
            animationDelay: `${i * 0.1}s`,
            height: '100%',
          }}
        />
      ))}
    </div>
  );
};

export default SoundWave;
