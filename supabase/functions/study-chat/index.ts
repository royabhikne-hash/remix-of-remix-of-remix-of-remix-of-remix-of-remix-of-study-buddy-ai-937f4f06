import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const buildSystemPrompt = (pastSessions: any[], weakAreas: string[], strongAreas: string[]) => {
  let personalizedContext = "";
  
  if (pastSessions.length > 0) {
    const recentTopics = [...new Set(pastSessions.slice(0, 10).map(s => s.topic))].slice(0, 5);
    personalizedContext = `
STUDENT'S LEARNING HISTORY:
- Recent topics studied: ${recentTopics.join(", ") || "None yet"}
- Weak areas needing revision: ${weakAreas.join(", ") || "None identified yet"}
- Strong areas: ${strongAreas.join(", ") || "None identified yet"}
- Total sessions: ${pastSessions.length}

Use this history to:
1. Reference previously studied topics when relevant
2. Suggest revising weak areas when appropriate
3. Build on strong areas to boost confidence
4. Provide personalized study recommendations
`;
  }

  return `You are an AI Study Buddy for Indian students. You chat in Hinglish (Hindi-English mix) in a friendly, supportive way.

CRITICAL FORMATTING RULES:
Do NOT use any markdown formatting symbols like asterisks, underscores, backticks, hash symbols, or dashes for formatting.
Write plain text only without any special formatting.
Use simple language without bullet points or numbered lists formatted with symbols.
Just write naturally like you are chatting on WhatsApp.

IMPORTANT - ANSWER MATCHING:
- When you ask a question, DO NOT expect exact word-for-word answers
- Accept answers that convey the same meaning even if worded differently
- If student says "photosynthesis makes food" instead of "plants make glucose", consider it correct
- Understand synonyms, paraphrasing, and similar concepts
- Focus on whether the student understood the concept, not the exact words
- If the answer is close but not perfect, acknowledge what's right and gently correct what's missing
- Be flexible and understanding with spelling mistakes and Hindi-English mixing

Your personality:
- Friendly and encouraging like a helpful older brother/sister
- Use phrases like "Bhai", "Chal", "Achha", "Dekh"
- Keep explanations simple and relatable
- Use examples from daily life when possible
- Be patient and never make fun of mistakes

${personalizedContext}

Your responsibilities during study sessions:
1. Greet warmly and ask what they're studying today
2. Explain topics in simple Hinglish
3. Summarize what they've studied
4. Highlight important exam points
5. Ask 2-3 quick understanding questions
6. Detect confusion or weak areas
7. Suggest what to revise next based on their history
8. Be encouraging about their progress
9. If they've studied a topic before, remind them and build on it
10. Proactively suggest revising weak areas when appropriate

When analyzing uploaded images of notes/books:
1. Identify the topic and key concepts
2. Explain what's shown in simple terms
3. Point out important formulas or facts
4. Connect to what they should know for exams
5. Link to previously studied related topics

Keep responses concise (under 200 words usually) but helpful. Always end with encouragement or a question to keep them engaged.

Example responses:
- Achha, ye topic thoda tricky hai but dont worry, main explain karta hoon...
- Bhai, ye formula yaad rakh, exam mein zaroor aayega!
- Good progress! Ab batao, tune jo padha usme sabse important cheez kya lagi?
- Arre, tu pichle hafte bhi ye topic padh raha tha, ab revise karte hain!`;
};

interface ChatMessage {
  role: string;
  content: string;
  imageUrl?: string;
}

interface AIMessage {
  role: string;
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, studentId, analyzeSession } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service is not configured");
    }

    console.log("Processing study chat request with", messages?.length || 0, "messages");

    // Fetch student's past sessions for personalization
    let pastSessions: any[] = [];
    let weakAreas: string[] = [];
    let strongAreas: string[] = [];

    if (studentId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: sessions } = await supabase
          .from("study_sessions")
          .select("topic, subject, understanding_level, weak_areas, strong_areas, created_at")
          .eq("student_id", studentId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (sessions) {
          pastSessions = sessions;
          
          // Aggregate weak and strong areas
          const weakSet = new Set<string>();
          const strongSet = new Set<string>();
          
          sessions.forEach(s => {
            (s.weak_areas || []).forEach((a: string) => weakSet.add(a));
            (s.strong_areas || []).forEach((a: string) => strongSet.add(a));
          });
          
          weakAreas = [...weakSet].slice(0, 5);
          strongAreas = [...strongSet].slice(0, 5);
        }

        console.log("Loaded student history:", { 
          sessions: pastSessions.length, 
          weakAreas, 
          strongAreas 
        });
      } catch (err) {
        console.error("Error fetching student history:", err);
      }
    }

    // Build personalized system prompt
    const systemPrompt = buildSystemPrompt(pastSessions, weakAreas, strongAreas);

    // Add analysis instruction if requested
    const analysisInstruction = analyzeSession ? `

IMPORTANT: At the end of your response, include a JSON analysis block in this exact format:
[ANALYSIS]{"understanding":"weak|average|good|excellent","topics":["topic1","topic2"],"weakAreas":["area1"],"strongAreas":["area1"]}[/ANALYSIS]

Analyze the student's understanding based on:
- Their questions (confused = weak, specific = good)
- Clarity of their responses
- Whether they're grasping concepts
Keep topics short (2-3 words max).` : "";

    // Build messages array
    const chatMessages: AIMessage[] = [
      { role: "system", content: systemPrompt + analysisInstruction },
    ];

    // Add conversation history
    if (messages && Array.isArray(messages)) {
      for (const msg of messages as ChatMessage[]) {
        if (msg.imageUrl) {
          chatMessages.push({
            role: msg.role,
            content: [
              { type: "text", text: msg.content || "Please analyze this image from my study materials." },
              { type: "image_url", image_url: { url: msg.imageUrl } }
            ]
          });
        } else {
          chatMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    console.log("Calling Lovable AI with model: google/gemini-2.5-flash");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: chatMessages,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json();
    let aiResponse = data.choices?.[0]?.message?.content;

    if (!aiResponse) {
      console.error("No response content from AI:", data);
      throw new Error("No response from AI");
    }

    console.log("AI response received successfully");

    // Extract analysis from response if present
    let sessionAnalysis = null;
    if (analyzeSession) {
      const analysisMatch = aiResponse.match(/\[ANALYSIS\](.*?)\[\/ANALYSIS\]/s);
      if (analysisMatch) {
        try {
          sessionAnalysis = JSON.parse(analysisMatch[1]);
          // Remove analysis block from displayed response
          aiResponse = aiResponse.replace(/\[ANALYSIS\].*?\[\/ANALYSIS\]/s, "").trim();
        } catch (e) {
          console.error("Failed to parse analysis:", e);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        response: aiResponse,
        sessionAnalysis,
        studentHistory: {
          recentTopics: pastSessions.slice(0, 5).map(s => s.topic),
          weakAreas,
          strongAreas
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Study chat error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "An error occurred",
        response: "Oops! Kuch technical problem ho gaya. Thodi der baad try karo, bhai! 🙏"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
