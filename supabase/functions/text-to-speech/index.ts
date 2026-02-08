import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SPEECHIFY_API_KEY = Deno.env.get('SPEECHIFY_API_KEY');
    
    if (!SPEECHIFY_API_KEY) {
      console.error('SPEECHIFY_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'TTS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { text, voiceId = 'henry', speed = 1.0, language = 'en-IN' } = await req.json();

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

    // Limit text length for cost optimization
    const maxLength = 5000;
    const truncatedText = cleanText.length > maxLength 
      ? cleanText.substring(0, maxLength) + '...'
      : cleanText;

    // Determine model based on content - use multilingual for Hindi text
    const hasHindi = containsHindi(truncatedText);
    const model = hasHindi ? 'simba-multilingual' : 'simba-english';

    console.log(`TTS Request: ${truncatedText.length} chars, voice: ${voiceId}, model: ${model}, hasHindi: ${hasHindi}`);

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
          textLength: truncatedText.length
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
    };

    // Add language hint for multilingual model
    if (hasHindi) {
      requestBody.language = 'hi-IN';
    }

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
      
      // Return a more helpful error for common issues
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
        model: model
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
