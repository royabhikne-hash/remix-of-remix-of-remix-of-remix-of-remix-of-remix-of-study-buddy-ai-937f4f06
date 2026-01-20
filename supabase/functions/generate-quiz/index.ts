import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChatMessage {
  role: string;
  content: string;
}

// In-memory rate limiting
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, maxRequests = 10, windowMs = 300000): boolean {
  const now = Date.now();
  const key = `quiz:${userId}`;
  const limit = rateLimits.get(key);
  
  if (!limit || now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (limit.count >= maxRequests) return false;
  limit.count++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, topic, studentLevel, weakAreas, strongAreas, studentId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service is not configured");
    }

    // Rate limit check (10 quizzes per 5 minutes)
    if (studentId && !checkRateLimit(studentId)) {
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded. Please wait before generating another quiz.",
          success: false
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating adaptive quiz for topic:", topic);
    console.log("Student level:", studentLevel);

    // Build context from chat messages (limited) - extract topics discussed
    const chatContext = messages
      ?.filter((m: ChatMessage) => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map((m: ChatMessage) => `${m.role}: ${m.content}`)
      .join("\n")
      .slice(-3000);

    const weakAreasText = weakAreas?.length > 0 ? weakAreas.join(", ") : "None identified";
    const strongAreasText = strongAreas?.length > 0 ? strongAreas.join(", ") : "None identified";

    // Enhanced prompt for topic-focused quiz generation
    const systemPrompt = `You are a quiz generator for Indian students studying "${topic || 'General Study'}".

CRITICAL RULES:
1. Generate EXACTLY 5 questions
2. ALL questions MUST be about "${topic || 'General Study'}" ONLY
3. DO NOT include questions from other subjects
4. If topic is Physics, ask ONLY Physics questions
5. If topic is Biology, ask ONLY Biology questions
6. Questions should be based on what was discussed in the study session
7. Use simple Hinglish (Hindi-English mix)
8. Number questions from 1 to 5 correctly

QUESTION TYPES:
- Mix of MCQ (4 options) and True/False
- Focus on weak areas: ${weakAreasText}
- Build confidence with strong areas: ${strongAreasText}

OUTPUT FORMAT (strictly JSON):
{
  "questions": [
    {
      "id": 1,
      "type": "mcq",
      "question": "Simple Hinglish question about ${topic}?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "The exact correct option text",
      "explanation": "Brief explanation in Hinglish",
      "difficulty": "easy",
      "topic": "${topic}"
    },
    {
      "id": 2,
      "type": "true_false",
      "question": "Statement about ${topic}?",
      "options": ["True", "False"],
      "correct_answer": "True",
      "explanation": "Why this is true/false",
      "difficulty": "medium",
      "topic": "${topic}"
    }
  ],
  "total_questions": 5
}

STUDY SESSION CONTEXT (use this to create relevant questions):
${chatContext || `General study session about ${topic || "various topics"}`}`;

    // Use fastest model
    const MODEL = "google/gemini-2.5-flash";

    console.log(`Calling Lovable AI for quiz with model: ${MODEL}`);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate 5 quiz questions for "${topic || 'General Study'}". Student level: ${studentLevel || 'average'}.` }
        ],
        max_tokens: 1500,
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("AI gateway error:", resp.status, errorText);

      if (resp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment.", success: false }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (resp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted.", success: false }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`AI service error: ${resp.status}`);
    }

    const data = await resp.json();
    let aiResponse = data?.choices?.[0]?.message?.content;

    if (typeof aiResponse !== "string" || aiResponse.trim().length === 0) {
      console.error("No response content from AI");
      throw new Error("No response from AI");
    }

    console.log("Quiz generation response received");

    // Extract JSON from response
    let quizData;
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        quizData = JSON.parse(jsonMatch[0]);
        // Ensure question IDs are sequential
        if (quizData.questions && Array.isArray(quizData.questions)) {
          quizData.questions = quizData.questions.map((q: any, idx: number) => ({
            ...q,
            id: idx + 1, // Force sequential IDs 1, 2, 3, 4, 5
            topic: q.topic || topic || "General Study"
          }));
          quizData.total_questions = quizData.questions.length;
        }
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Failed to parse quiz JSON:", e);
      // Generate fallback questions with proper IDs
      quizData = {
        questions: [
          {
            id: 1,
            type: "mcq",
            question: `${topic || "Is session"} mein sabse important concept kya tha?`,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correct_answer: "Option A",
            explanation: "Ye session ka main concept hai.",
            difficulty: "medium",
            topic: topic || "General"
          },
          {
            id: 2,
            type: "true_false",
            question: `${topic || "Is topic"} ke concepts clear hain?`,
            options: ["True", "False"],
            correct_answer: "True",
            explanation: "Practice se samajh aur better hogi!",
            difficulty: "easy",
            topic: topic || "General"
          },
          {
            id: 3,
            type: "mcq",
            question: `${topic || "Padhai"} mein konsa part sabse important hai?`,
            options: ["Basics", "Practice", "Revision", "All of these"],
            correct_answer: "All of these",
            explanation: "Sab important hain padhai mein!",
            difficulty: "easy",
            topic: topic || "General"
          },
          {
            id: 4,
            type: "true_false",
            question: "Regular practice se improvement hoti hai?",
            options: ["True", "False"],
            correct_answer: "True",
            explanation: "Haan, daily practice bahut zaroori hai!",
            difficulty: "easy",
            topic: topic || "General"
          },
          {
            id: 5,
            type: "mcq",
            question: "Notes banana kab helpful hota hai?",
            options: ["Class mein", "Revision mein", "Exam mein", "Har jagah"],
            correct_answer: "Har jagah",
            explanation: "Notes har jagah kaam aate hain!",
            difficulty: "easy",
            topic: topic || "General"
          }
        ],
        total_questions: 5
      };
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        quiz: quizData
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Quiz generation error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "An error occurred",
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});