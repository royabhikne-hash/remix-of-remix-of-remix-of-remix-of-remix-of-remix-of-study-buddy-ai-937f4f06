import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Image, X, Loader2, Brain, TrendingUp, AlertTriangle, Volume2, VolumeX, CheckCircle, XCircle, ThumbsUp, HelpCircle, Lightbulb, Bot, User, Mic, MicOff, Settings2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionType {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionType;
    webkitSpeechRecognition: new () => SpeechRecognitionType;
  }
}

type ReactionType = "like" | "helpful" | "confusing";

interface MessageReaction {
  type: ReactionType;
  count: number;
  userReacted: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageUrl?: string;
  reactions?: Record<ReactionType, MessageReaction>;
}

interface RealTimeAnalysis {
  weakAreas: string[];
  strongAreas: string[];
  currentUnderstanding: "weak" | "average" | "good" | "excellent";
  topicsCovered: string[];
}

interface QuizQuestion {
  id: number;
  type: "mcq" | "true_false" | "fill_blank" | "short_answer";
  question: string;
  options?: string[];
  correct_answer: string;
  explanation: string;
  difficulty: string;
  topic: string;
}

interface StudyChatProps {
  onEndStudy: (summary: { 
    topic: string; 
    timeSpent: number; 
    messages: ChatMessage[];
    analysis: RealTimeAnalysis;
    sessionId?: string;
    quizResult?: {
      correctCount: number;
      totalQuestions: number;
      accuracy: number;
      understanding: "strong" | "partial" | "weak";
      questions: QuizQuestion[];
      answers: string[];
    };
  }) => void;
  studentId?: string;
}

const StudyChat = ({ onEndStudy, studentId }: StudyChatProps) => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content: "Bhai, aaj kya padh raha hai? Chal bata kaunsa subject ya chapter start karna hai! 📚",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [startTime] = useState(new Date());
  const [currentTopic, setCurrentTopic] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  
  // Quiz mode state
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  
  // Real-time analysis state
  const [analysis, setAnalysis] = useState<RealTimeAnalysis>({
    weakAreas: [],
    strongAreas: [],
    currentUnderstanding: "average",
    topicsCovered: [],
  });
  
  // Message reactions state
  const [messageReactions, setMessageReactions] = useState<Record<string, Record<ReactionType, MessageReaction>>>({});
  
  // Voice input state
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load voices when available
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      console.log('Available voices:', voices.map(v => `${v.name} (${v.lang})`));
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Check for speech recognition support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN'; // Hindi-India for Hinglish support
      
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        console.log('Speech recognized:', transcript);
        setInputValue(transcript);
      };
      
      recognition.onend = () => {
        console.log('Speech recognition ended');
        setIsListening(false);
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          toast({
            title: "Microphone Access Denied",
            description: "Microphone use karne ke liye permission do.",
            variant: "destructive"
          });
        } else if (event.error === 'no-speech') {
          toast({
            title: "Kuch sunai nahi diya",
            description: "Phir se bolke try karo.",
          });
        }
      };
      
      recognitionRef.current = recognition;
    } else {
      console.log('Speech recognition not supported');
    }
  }, [toast]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      toast({
        title: "Not Supported",
        description: "Aapka browser voice input support nahi karta. Chrome use karo.",
        variant: "destructive"
      });
      return;
    }
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      // Stop any ongoing speech first
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      
      setInputValue('');
      try {
        recognitionRef.current.start();
        setIsListening(true);
        toast({
          title: "🎤 Bol raha hun...",
          description: "Ab bolo - main sun raha hun!",
          duration: 2000
        });
      } catch (error) {
        console.error('Error starting recognition:', error);
        toast({
          title: "Error",
          description: "Voice input start nahi ho paya. Refresh karke try karo.",
          variant: "destructive"
        });
      }
    }
  }, [isListening, toast]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentQuestionIndex]);

  // Handle message reactions
  const handleReaction = (messageId: string, reactionType: ReactionType) => {
    setMessageReactions(prev => {
      const messageReacts = prev[messageId] || {
        like: { type: "like", count: 0, userReacted: false },
        helpful: { type: "helpful", count: 0, userReacted: false },
        confusing: { type: "confusing", count: 0, userReacted: false }
      };
      
      const currentReaction = messageReacts[reactionType];
      const newUserReacted = !currentReaction.userReacted;
      
      return {
        ...prev,
        [messageId]: {
          ...messageReacts,
          [reactionType]: {
            ...currentReaction,
            count: newUserReacted ? currentReaction.count + 1 : Math.max(0, currentReaction.count - 1),
            userReacted: newUserReacted
          }
        }
      };
    });

    const reactionLabels: Record<ReactionType, string> = {
      like: "👍 Liked!",
      helpful: "💡 Marked as helpful!",
      confusing: "🤔 Marked as confusing - we'll explain better!"
    };
    
    toast({
      title: reactionLabels[reactionType],
      duration: 1500
    });
  };

  // Web Speech API Text-to-Speech function (free, no API key needed)
  const speakText = (text: string, messageId: string) => {
    // If already speaking this message, stop
    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    const cleanText = text.replace(/[🎉📚💪🤖👋✓✔❌⚠️🙏👍]/g, '').trim();
    
    if (!cleanText) return;
    
    setSpeakingMessageId(messageId);
    
    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'hi-IN'; // Hindi for Hinglish support
      utterance.rate = voiceSpeed;
      utterance.pitch = 1.0;
      
      // Try to find a Hindi male voice
      const voices = window.speechSynthesis.getVoices();
      const hindiVoice = voices.find(v => v.lang.includes('hi') && v.name.toLowerCase().includes('male')) ||
                         voices.find(v => v.lang.includes('hi')) ||
                         voices.find(v => v.lang.includes('en-IN'));
      
      if (hindiVoice) {
        utterance.voice = hindiVoice;
      }

      utterance.onend = () => {
        setSpeakingMessageId(null);
      };

      utterance.onerror = () => {
        setSpeakingMessageId(null);
        toast({
          title: "Audio Error",
          description: "Could not play audio",
          variant: "destructive"
        });
      };

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("TTS error:", error);
      setSpeakingMessageId(null);
      toast({
        title: "Voice Error", 
        description: "Could not generate voice. Try again.",
        variant: "destructive"
      });
    }
  };

  const getAIResponse = async (conversationHistory: ChatMessage[]) => {
    try {
      const formattedMessages = conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
        imageUrl: msg.imageUrl
      }));

      const { data, error } = await supabase.functions.invoke('study-chat', {
        body: { messages: formattedMessages, studentId, analyzeSession: true }
      });

      if (error) {
        console.error("Edge function error:", error);
        throw error;
      }

      if (data?.error) {
        toast({
          title: "AI Error",
          description: data.error,
          variant: "destructive"
        });
      }

      if (data?.sessionAnalysis) {
        setAnalysis(prev => ({
          weakAreas: [...new Set([...prev.weakAreas, ...(data.sessionAnalysis.weakAreas || [])])],
          strongAreas: [...new Set([...prev.strongAreas, ...(data.sessionAnalysis.strongAreas || [])])],
          currentUnderstanding: data.sessionAnalysis.understanding || prev.currentUnderstanding,
          topicsCovered: [...new Set([...prev.topicsCovered, ...(data.sessionAnalysis.topics || [])])],
        }));
      }

      return data?.response || "Sorry bhai, kuch problem ho gaya. Phir se try kar!";
    } catch (err) {
      console.error("AI response error:", err);
      return "Oops! Connection mein problem hai. Thodi der baad try karo! 🙏";
    }
  };

  const [sessionId, setSessionId] = useState<string | null>(null);

  const saveMessageToDb = async (message: ChatMessage, sessId: string) => {
    try {
      await supabase.from("chat_messages").insert({
        session_id: sessId,
        role: message.role,
        content: message.content,
        image_url: message.imageUrl || null,
      });
    } catch (err) {
      console.error("Error saving message:", err);
    }
  };

  const ensureSession = async (detectedTopic?: string): Promise<string | null> => {
    if (sessionId) {
      // Update topic if we detected a new one and session already exists
      if (detectedTopic && detectedTopic !== "General Study") {
        await supabase
          .from("study_sessions")
          .update({ 
            topic: detectedTopic,
            subject: detectedTopic 
          })
          .eq("id", sessionId);
      }
      return sessionId;
    }
    
    if (!studentId) return null;

    const topicToSave = detectedTopic || currentTopic || "General Study";

    try {
      const { data, error } = await supabase
        .from("study_sessions")
        .insert({
          student_id: studentId,
          topic: topicToSave,
          subject: topicToSave !== "General Study" ? topicToSave : null,
          start_time: startTime.toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;
      
      setSessionId(data.id);
      return data.id;
    } catch (err) {
      console.error("Error creating session:", err);
      return null;
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() && !selectedImage) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
      imageUrl: selectedImage || undefined,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputValue("");
    setSelectedImage(null);
    setIsLoading(true);

    const topicKeywords = ["physics", "chemistry", "maths", "math", "biology", "history", "geography", "english", "hindi", "science", "social", "economics", "political", "civics", "computer", "bio"];
    const foundTopic = topicKeywords.find((t) => inputValue.toLowerCase().includes(t));
    let detectedTopic = currentTopic;
    
    if (foundTopic) {
      // Map common variations to proper names
      const topicMap: Record<string, string> = {
        "maths": "Math",
        "bio": "Biology",
        "political": "Political Science",
        "civics": "Civics",
        "social": "Social Science"
      };
      detectedTopic = topicMap[foundTopic] || foundTopic.charAt(0).toUpperCase() + foundTopic.slice(1);
      if (!currentTopic) {
        setCurrentTopic(detectedTopic);
      }
    }

    const sessId = await ensureSession(detectedTopic);
    if (sessId) {
      await saveMessageToDb(userMessage, sessId);
    }

    const aiResponseText = await getAIResponse(newMessages);
    
    const aiResponse: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: aiResponseText,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, aiResponse]);
    
    if (sessId) {
      await saveMessageToDb(aiResponse, sessId);
    }
    
    setIsLoading(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Image too large",
          description: "Please upload an image smaller than 5MB",
          variant: "destructive"
        });
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEndStudyClick = async () => {
    setQuizLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { 
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          topic: currentTopic || "General Study",
          studentLevel: analysis.currentUnderstanding,
          weakAreas: analysis.weakAreas,
          strongAreas: analysis.strongAreas
        }
      });

      if (error) throw error;

      if (data?.success && data?.quiz?.questions?.length > 0) {
        setQuizQuestions(data.quiz.questions);
        setIsQuizMode(true);
        setCurrentQuestionIndex(0);
        setUserAnswers([]);
        
        // Adaptive intro message based on student's performance
        const hasWeakAreas = analysis.weakAreas.length > 0;
        const introMessage = hasWeakAreas 
          ? `Achha bhai! Maine dekha tune ${analysis.weakAreas.slice(0, 2).join(" aur ")} mein thoda struggle kiya. Koi baat nahi - ye ${data.quiz.questions.length} questions tujhe is topic samajhne mein help karenge! Ready?`
          : `Bahut badhiya padhai ki tune! Ab dekhte hain tune kitna samjha. Ye ${data.quiz.questions.length} quick questions hain - chal shuru karte hain!`;
        
        const quizIntro: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: introMessage,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, quizIntro]);
      } else {
        finishStudySession();
      }
    } catch (err) {
      console.error("Quiz generation error:", err);
      toast({
        title: "Quiz Error",
        description: "Could not generate quiz. Ending session without quiz.",
        variant: "destructive"
      });
      finishStudySession();
    } finally {
      setQuizLoading(false);
    }
  };

  const handleQuizAnswer = (answer: string) => {
    setSelectedOption(answer);
    setShowExplanation(true);
    
    const newAnswers = [...userAnswers, answer];
    setUserAnswers(newAnswers);
  };

  const handleNextQuestion = () => {
    setSelectedOption(null);
    setShowExplanation(false);
    
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      calculateQuizResults();
    }
  };

  const calculateQuizResults = () => {
    let correctCount = 0;
    quizQuestions.forEach((q, i) => {
      const userAnswer = userAnswers[i]?.toLowerCase().trim();
      const correctAnswer = q.correct_answer?.toLowerCase().trim();
      if (userAnswer === correctAnswer || 
          (q.options && q.options.indexOf(userAnswers[i]) === q.options.map(o => o.toLowerCase()).indexOf(correctAnswer))) {
        correctCount++;
      }
    });

    const accuracy = Math.round((correctCount / quizQuestions.length) * 100);
    let understanding: "strong" | "partial" | "weak";
    
    if (accuracy >= 70) understanding = "strong";
    else if (accuracy >= 40) understanding = "partial";
    else understanding = "weak";

    setShowResult(true);

    const resultMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "assistant",
      content: getResultMessage(correctCount, quizQuestions.length, understanding),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, resultMessage]);

    setTimeout(() => {
      onEndStudy({
        topic: currentTopic || "General Study",
        timeSpent: Math.max(Math.round((new Date().getTime() - startTime.getTime()) / 60000), 1),
        messages,
        analysis,
        sessionId: sessionId || undefined,
        quizResult: {
          correctCount,
          totalQuestions: quizQuestions.length,
          accuracy,
          understanding,
          questions: quizQuestions,
          answers: userAnswers
        }
      });
    }, 3000);
  };

  const getResultMessage = (correct: number, total: number, understanding: string) => {
    const accuracy = Math.round((correct / total) * 100);
    
    if (understanding === "strong") {
      return `🎉 Bahut badhiya bhai! Tune ${correct}/${total} (${accuracy}%) sahi kiye! Ye topic tera strong hai. Keep it up! ✔`;
    } else if (understanding === "partial") {
      return `👍 Theek hai bhai! ${correct}/${total} (${accuracy}%) correct. Kuch concepts clear hain but thoda aur practice chahiye. Koi baat nahi, improvement aa rahi hai!`;
    } else {
      return `⚠️ Bhai ${correct}/${total} (${accuracy}%) hi sahi hue. Is topic ko dobara padhna padega. Don't worry, agli baar better karenge! 💪`;
    }
  };

  const finishStudySession = () => {
    const timeSpent = Math.round((new Date().getTime() - startTime.getTime()) / 60000);
    onEndStudy({
      topic: currentTopic || "General Study",
      timeSpent: Math.max(timeSpent, 1),
      messages,
      analysis,
      sessionId: sessionId || undefined,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const currentQuestion = quizQuestions[currentQuestionIndex];

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      {/* Minimal ChatGPT-style Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">AI Study Buddy</h3>
            <p className="text-xs text-muted-foreground">
              {isQuizMode ? `Quiz ${currentQuestionIndex + 1}/${quizQuestions.length}` : currentTopic || "Online"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Voice Speed Control */}
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-muted-foreground hover:text-foreground h-8 px-2 gap-1"
              >
                <Settings2 className="w-4 h-4" />
                <span className="text-xs">{voiceSpeed}x</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-4" align="end">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Voice Speed</span>
                  <span className="text-sm text-muted-foreground">{voiceSpeed}x</span>
                </div>
                <Slider
                  value={[voiceSpeed]}
                  onValueChange={(val) => setVoiceSpeed(val[0])}
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Slow</span>
                  <span>Fast</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
          >
            <Brain className="w-4 h-4" />
          </Button>
          {!isQuizMode && (
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleEndStudyClick}
              disabled={quizLoading}
              className="h-8 px-3 text-xs"
            >
              {quizLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "End"}
            </Button>
          )}
        </div>
      </div>

      {/* Analysis Panel */}
      {showAnalysis && (
        <div className="px-4 py-3 bg-muted/50 border-b border-border">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Understanding:</span>
            <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${
              analysis.currentUnderstanding === "excellent" ? "bg-accent/20 text-accent" :
              analysis.currentUnderstanding === "good" ? "bg-primary/20 text-primary" :
              analysis.currentUnderstanding === "average" ? "bg-warning/20 text-warning" :
              "bg-destructive/20 text-destructive"
            }`}>
              {analysis.currentUnderstanding}
            </span>
            {analysis.strongAreas.length > 0 && (
              <span className="text-accent flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> {analysis.strongAreas.slice(0, 2).join(", ")}
              </span>
            )}
            {analysis.weakAreas.length > 0 && (
              <span className="text-warning flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {analysis.weakAreas.slice(0, 2).join(", ")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ChatGPT-style Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((message) => {
          const reactions = messageReactions[message.id];
          const isUser = message.role === "user";
          
          return (
            <div
              key={message.id}
              className={`py-6 px-4 ${isUser ? "bg-background" : "bg-muted/30"}`}
            >
              <div className="max-w-3xl mx-auto flex gap-4">
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                  isUser ? "bg-primary text-primary-foreground" : "bg-accent/20 text-accent"
                }`}>
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">
                      {isUser ? "You" : "AI Study Buddy"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  
                  {message.imageUrl && (
                    <img
                      src={message.imageUrl}
                      alt="Uploaded"
                      className="max-w-[200px] rounded-lg mb-2"
                    />
                  )}
                  
                  <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </p>
                  
                  {/* AI message actions */}
                  {!isUser && (
                    <div className="flex items-center gap-1 mt-3">
                      <button
                        onClick={() => speakText(message.content, message.id)}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title="Read aloud"
                      >
                        {speakingMessageId === message.id ? (
                          <VolumeX className="w-4 h-4 text-primary" />
                        ) : (
                          <Volume2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        )}
                      </button>
                      <div className="w-px h-4 bg-border mx-1" />
                      <button
                        onClick={() => handleReaction(message.id, "like")}
                        className={`p-1.5 rounded transition-colors ${
                          reactions?.like?.userReacted ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                        title="Like"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReaction(message.id, "helpful")}
                        className={`p-1.5 rounded transition-colors ${
                          reactions?.helpful?.userReacted ? "bg-accent/10 text-accent" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                        title="Helpful"
                      >
                        <Lightbulb className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReaction(message.id, "confusing")}
                        className={`p-1.5 rounded transition-colors ${
                          reactions?.confusing?.userReacted ? "bg-warning/10 text-warning" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                        title="Confusing"
                      >
                        <HelpCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        
        {/* Quiz Question UI */}
        {isQuizMode && currentQuestion && !showResult && (
          <div className="py-5 bg-muted/20">
            <div className="max-w-2xl mx-auto px-4 flex gap-3">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-accent/80 to-accent text-accent-foreground">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    Q{currentQuestionIndex + 1}/{quizQuestions.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {currentQuestion.difficulty}
                  </span>
                </div>
                <p className="font-medium text-base mb-4">{currentQuestion.question}</p>
                
                {currentQuestion.type === "mcq" && currentQuestion.options && (
                  <div className="space-y-2">
                    {currentQuestion.options.map((option, idx) => {
                      const isSelected = selectedOption === option;
                      const isCorrect = option.toLowerCase() === currentQuestion.correct_answer.toLowerCase();
                      const showFeedback = showExplanation;
                      
                      return (
                        <button
                          key={idx}
                          onClick={() => !showExplanation && handleQuizAnswer(option)}
                          disabled={showExplanation}
                          className={`w-full text-left p-3 rounded-xl border transition-all text-sm ${
                            showFeedback
                              ? isCorrect
                                ? "bg-accent/10 border-accent"
                                : isSelected
                                  ? "bg-destructive/10 border-destructive"
                                  : "bg-muted/50 border-border"
                              : isSelected
                                ? "bg-primary/10 border-primary"
                                : "bg-background border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{String.fromCharCode(65 + idx)}. {option}</span>
                            {showFeedback && isCorrect && <CheckCircle className="w-4 h-4 text-accent" />}
                            {showFeedback && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-destructive" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQuestion.type === "true_false" && (
                  <div className="flex gap-2">
                    {["True", "False"].map((option) => {
                      const isSelected = selectedOption === option;
                      const isCorrect = option.toLowerCase() === currentQuestion.correct_answer.toLowerCase();
                      const showFeedback = showExplanation;
                      
                      return (
                        <button
                          key={option}
                          onClick={() => !showExplanation && handleQuizAnswer(option)}
                          disabled={showExplanation}
                          className={`flex-1 p-3 rounded-xl border transition-all text-sm ${
                            showFeedback
                              ? isCorrect
                                ? "bg-accent/10 border-accent"
                                : isSelected
                                  ? "bg-destructive/10 border-destructive"
                                  : "bg-muted/50 border-border"
                              : isSelected
                                ? "bg-primary/10 border-primary"
                                : "bg-background border-border hover:border-primary/50"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                )}

                {(currentQuestion.type === "fill_blank" || currentQuestion.type === "short_answer") && !showExplanation && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type your answer..."
                      value={selectedOption || ""}
                      onChange={(e) => setSelectedOption(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter" && selectedOption) {
                          handleQuizAnswer(selectedOption);
                        }
                      }}
                      className="rounded-xl"
                    />
                    <Button onClick={() => selectedOption && handleQuizAnswer(selectedOption)} disabled={!selectedOption} className="rounded-xl">
                      Submit
                    </Button>
                  </div>
                )}

                {showExplanation && (
                  <div className="mt-4 p-3 bg-muted/50 rounded-xl">
                    <p className="text-sm font-medium mb-1">Answer: {currentQuestion.correct_answer}</p>
                    <p className="text-sm text-muted-foreground">{currentQuestion.explanation}</p>
                    <Button 
                      className="mt-3 w-full rounded-xl" 
                      onClick={handleNextQuestion}
                    >
                      {currentQuestionIndex < quizQuestions.length - 1 ? "Next" : "See Results"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Loading indicator - ChatGPT style */}
        {isLoading && (
          <div className="py-5 bg-muted/20">
            <div className="max-w-2xl mx-auto px-4 flex gap-3">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-accent/80 to-accent text-accent-foreground">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{animationDelay: "0ms"}}></div>
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{animationDelay: "150ms"}}></div>
                <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{animationDelay: "300ms"}}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {selectedImage && (
        <div className="px-4 py-2 bg-muted/30 border-t border-border/50">
          <div className="max-w-2xl mx-auto">
            <div className="relative inline-block">
              <img src={selectedImage} alt="Preview" className="h-16 rounded-lg shadow-sm" />
              <button
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center shadow-sm"
                onClick={() => setSelectedImage(null)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ChatGPT-style Input - Clean rounded pill with voice input */}
      {!isQuizMode && (
        <div className="border-t border-border/50 bg-background p-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 bg-muted/50 border border-border/50 rounded-full px-3 py-2 focus-within:border-primary/50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Image className="w-4 h-4" />
              </Button>
              
              {/* Voice Input Button */}
              {speechSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleListening}
                  className={`shrink-0 h-8 w-8 rounded-full transition-colors ${
                    isListening 
                      ? "bg-destructive/20 text-destructive hover:bg-destructive/30" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
              
              <Input
                placeholder={isListening ? "Listening..." : "Message..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-8 text-sm"
                disabled={isLoading || isListening}
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={!inputValue.trim() && !selectedImage}
                className="shrink-0 h-8 w-8 rounded-full"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            {isListening && (
              <p className="text-xs text-center text-muted-foreground mt-2 animate-pulse">
                🎤 Bol dijiye... main sun raha hoon
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudyChat;
