import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// In-memory cache for audio (reduces API calls for repeated text)
const audioCache = new Map<string, { audio: string; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache

// Clean text for TTS (remove emojis, markdown, etc.)
function sanitizeText(text: string): string {
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
}

// Generate cache key from text and voice settings
function getCacheKey(text: string, voiceId: string, model: string): string {
  const normalizedText = sanitizeText(text).toLowerCase().substring(0, 500);
  return `${model}:${voiceId}:${normalizedText}`;
}

// Clean expired cache entries
function cleanCache(): void {
  const now = Date.now();
  for (const [key, value] of audioCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      audioCache.delete(key);
    }
  }
}

// Detect if text contains Hindi/Devanagari script
function containsHindi(text: string): boolean {
  const hindiPattern = /[\u0900-\u097F]/;
  return hindiPattern.test(text);
}

// Check if student can use premium TTS and track usage
async function checkAndTrackUsage(
  supabase: any,
  studentId: string,
  textLength: number
): Promise<{ canUse: boolean; usageInfo?: any; reason?: string }> {
  try {
    // Get current subscription
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('student_id', studentId)
      .maybeSingle();

    if (error || !sub) {
      return { canUse: false, reason: 'No subscription found' };
    }

    // Check if Pro plan and active
    const isPro = sub.plan === 'pro' && sub.is_active;
    const isExpired = sub.end_date && new Date(sub.end_date) < new Date();
    const hasQuota = sub.tts_used + textLength <= sub.tts_limit;

    if (!isPro) {
      return { 
        canUse: false, 
        reason: 'Basic plan - use Web TTS',
        usageInfo: {
          plan: 'basic',
          ttsUsed: sub.tts_used,
          ttsLimit: sub.tts_limit,
          ttsRemaining: sub.tts_limit - sub.tts_used,
          canUsePremium: false,
        }
      };
    }

    if (isExpired) {
      return { canUse: false, reason: 'Pro subscription expired' };
    }

    if (!hasQuota) {
      return { 
        canUse: false, 
        reason: 'TTS limit reached',
        usageInfo: {
          plan: 'pro',
          ttsUsed: sub.tts_used,
          ttsLimit: sub.tts_limit,
          ttsRemaining: 0,
          canUsePremium: false,
        }
      };
    }

    // Update usage count
    const newTtsUsed = sub.tts_used + textLength;
    await supabase
      .from('subscriptions')
      .update({ tts_used: newTtsUsed })
      .eq('id', sub.id);

    return { 
      canUse: true,
      usageInfo: {
        plan: 'pro',
        ttsUsed: newTtsUsed,
        ttsLimit: sub.tts_limit,
        ttsRemaining: sub.tts_limit - newTtsUsed,
        canUsePremium: newTtsUsed < sub.tts_limit,
      }
    };
  } catch (err) {
    console.error('Usage check error:', err);
    return { canUse: false, reason: 'Usage check failed' };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SPEECHIFY_API_KEY = Deno.env.get('SPEECHIFY_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!SPEECHIFY_API_KEY) {
      console.error('SPEECHIFY_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'TTS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { text, voiceId = 'henry', speed = 1.0, language = 'en-IN', studentId } = await req.json();

    if (!text || typeof text !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanText = sanitizeText(text);
    
    if (!cleanText || cleanText.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No speakable text provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit text length for faster response (shorter = faster TTS)
    const maxLength = 5000;
    const truncatedText = cleanText.length > maxLength 
      ? cleanText.substring(0, maxLength) + '...'
      : cleanText;

    // Check subscription and track usage if studentId provided
    let usageInfo = null;
    if (studentId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const usageResult = await checkAndTrackUsage(supabase, studentId, truncatedText.length);
      
      if (!usageResult.canUse) {
        // Return fallback signal - client should use Web TTS
        return new Response(
          JSON.stringify({ 
            error: 'FALLBACK_TO_WEB_TTS',
            reason: usageResult.reason,
            usageInfo: usageResult.usageInfo,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      usageInfo = usageResult.usageInfo;
    }

    // Determine model based on content - use multilingual for Hindi/Hinglish text
    const hasHindi = containsHindi(truncatedText);
    // Always use simba-multilingual for better Hindi/Hinglish support
    const model = 'simba-multilingual';
    
    // Always use hi-IN for Indian accent - this ensures voices like Henry/Natasha 
    // speak with proper Indian accent even for English text
    const detectedLanguage = 'hi-IN';

    console.log(`TTS Request: ${truncatedText.length} chars, voice: ${voiceId}, model: ${model}, language: ${detectedLanguage}, hasHindi: ${hasHindi}, studentId: ${studentId || 'none'}`);

    // Check cache first
    cleanCache();
    const cacheKey = getCacheKey(truncatedText, voiceId, model);
    const cached = audioCache.get(cacheKey);
    
    if (cached) {
      console.log('TTS: Cache hit');
      return new Response(
        JSON.stringify({ 
          audio: cached.audio, 
          cached: true,
          format: 'mp3',
          textLength: truncatedText.length,
          model: model,
          usageInfo: usageInfo,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Speechify API
    console.log('TTS: Calling Speechify API...');
    
    const requestBody: Record<string, any> = {
      input: truncatedText,
      voice_id: voiceId,
      audio_format: 'mp3',
      model: model,
      language: detectedLanguage,
    };

    const speechifyResponse = await fetch('https://api.sws.speechify.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SPEECHIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!speechifyResponse.ok) {
      const errorText = await speechifyResponse.text();
      console.error('Speechify API error:', speechifyResponse.status, errorText);
      
      if (speechifyResponse.status === 401) {
        return new Response(
          JSON.stringify({ error: 'TTS authentication failed. Please check API key.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (speechifyResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'TTS rate limit reached. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'TTS generation failed', details: errorText }),
        { status: speechifyResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Speechify API returns JSON with audio_data field containing base64 audio
    const speechifyData = await speechifyResponse.json();
    
    if (!speechifyData.audio_data) {
      console.error('Speechify response missing audio_data:', JSON.stringify(speechifyData).substring(0, 200));
      return new Response(
        JSON.stringify({ error: 'Invalid response from TTS service' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const audioBase64 = speechifyData.audio_data;
    const audioSize = Math.round(audioBase64.length * 0.75); // Approximate decoded size
    
    console.log(`TTS: Generated ~${audioSize} bytes of audio`);

    // Cache the result
    audioCache.set(cacheKey, {
      audio: audioBase64,
      timestamp: Date.now()
    });

    // Limit cache size (keep last 100 entries)
    if (audioCache.size > 100) {
      const oldestKey = audioCache.keys().next().value;
      if (oldestKey) audioCache.delete(oldestKey);
    }

    return new Response(
      JSON.stringify({ 
        audio: audioBase64, 
        cached: false,
        format: 'mp3',
        textLength: truncatedText.length,
        audioSize: audioSize,
        model: model,
        usageInfo: usageInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('TTS Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
