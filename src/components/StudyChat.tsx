import { useState, useRef, useEffect } from "react";
import { Send, Image, X, Loader2, Brain, TrendingUp, AlertTriangle, Volume2, VolumeX, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageUrl?: string;
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentQuestionIndex]);

  // Text-to-Speech function
  const speakText = (text: string, messageId: string) => {
    if ('speechSynthesis' in window) {
      // Stop any ongoing speech
      window.speechSynthesis.cancel();
      
      if (speakingMessageId === messageId) {
        setSpeakingMessageId(null);
        return;
      }

      // Clean text for speech (remove emojis and special chars)
      const cleanText = text.replace(/[🎉📚💪🤖👋✓✔❌⚠️🙏]/g, '').trim();
      
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'hi-IN'; // Hindi for Hinglish content
      utterance.rate = 0.9;
      utterance.pitch = 1;
      
      utterance.onstart = () => setSpeakingMessageId(messageId);
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);
      
      window.speechSynthesis.speak(utterance);
    } else {
      toast({
        title: "Not Supported",
        description: "Text-to-speech is not supported in your browser.",
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

    const topicKeywords = ["physics", "chemistry", "maths", "math", "biology", "history", "geography", "english", "hindi", "science", "social"];
    const foundTopic = topicKeywords.find((t) => inputValue.toLowerCase().includes(t));
    if (foundTopic && !currentTopic) {
      setCurrentTopic(foundTopic.charAt(0).toUpperCase() + foundTopic.slice(1));
    }

    const aiResponseText = await getAIResponse(newMessages);
    
    const aiResponse: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: aiResponseText,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, aiResponse]);
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

  // Generate quiz when ending study
  const handleEndStudyClick = async () => {
    setQuizLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { 
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          topic: currentTopic || "General Study",
          studentLevel: analysis.currentUnderstanding
        }
      });

      if (error) throw error;

      if (data?.success && data?.quiz?.questions?.length > 0) {
        setQuizQuestions(data.quiz.questions);
        setIsQuizMode(true);
        setCurrentQuestionIndex(0);
        setUserAnswers([]);
        
        // Add quiz intro message
        const quizIntro: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: `Achha bhai! Ab dekhte hain tune kitna samjha. Main tujhse ${data.quiz.questions.length} questions poochunga jo tune abhi padha usse related hain. Ready ho ja! 💪`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, quizIntro]);
      } else {
        // No quiz, end directly
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
      // Quiz complete, calculate results
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

    // Add result message
    const resultMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "assistant",
      content: getResultMessage(correctCount, quizQuestions.length, understanding),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, resultMessage]);

    // End session after showing result
    setTimeout(() => {
      onEndStudy({
        topic: currentTopic || "General Study",
        timeSpent: Math.max(Math.round((new Date().getTime() - startTime.getTime()) / 60000), 1),
        messages,
        analysis,
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
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getUnderstandingColor = () => {
    switch (analysis.currentUnderstanding) {
      case "excellent": return "text-accent";
      case "good": return "text-primary";
      case "average": return "text-warning";
      case "weak": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  const currentQuestion = quizQuestions[currentQuestionIndex];

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] bg-card rounded-2xl border border-border overflow-hidden">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="text-lg">🤖</span>
          </div>
          <div>
            <h3 className="font-semibold">AI Study Buddy</h3>
            <p className="text-xs text-muted-foreground">
              {isQuizMode ? `Quiz: ${currentQuestionIndex + 1}/${quizQuestions.length}` : currentTopic ? `Studying: ${currentTopic}` : "Ready to help!"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="hidden sm:flex"
          >
            <Brain className="w-4 h-4 mr-1" />
            Analysis
          </Button>
          {!isQuizMode && (
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={handleEndStudyClick}
              disabled={quizLoading}
            >
              {quizLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "End Study"}
            </Button>
          )}
        </div>
      </div>

      {/* Real-time Analysis Panel */}
      {showAnalysis && (
        <div className="px-4 py-3 bg-muted/50 border-b border-border space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Understanding:</span>
            <span className={`font-semibold capitalize ${getUnderstandingColor()}`}>
              {analysis.currentUnderstanding}
            </span>
          </div>
          {analysis.topicsCovered.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground">Topics:</span>
              {analysis.topicsCovered.slice(0, 3).map((topic, i) => (
                <span key={i} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-4 text-xs">
            {analysis.strongAreas.length > 0 && (
              <div className="flex items-center gap-1 text-accent">
                <TrendingUp className="w-3 h-3" />
                Strong: {analysis.strongAreas.slice(0, 2).join(", ")}
              </div>
            )}
            {analysis.weakAreas.length > 0 && (
              <div className="flex items-center gap-1 text-warning">
                <AlertTriangle className="w-3 h-3" />
                Needs work: {analysis.weakAreas.slice(0, 2).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
          >
            <div className={`${message.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"} relative group`}>
              {message.imageUrl && (
                <img
                  src={message.imageUrl}
                  alt="Uploaded"
                  className="max-w-[200px] rounded-lg mb-2"
                />
              )}
              <p className="whitespace-pre-wrap">{message.content}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs opacity-60">
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {message.role === "assistant" && (
                  <button
                    onClick={() => speakText(message.content, message.id)}
                    className="ml-2 p-1 rounded-full hover:bg-primary/10 transition-colors"
                    title="Read aloud"
                  >
                    {speakingMessageId === message.id ? (
                      <VolumeX className="w-4 h-4 text-primary" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-muted-foreground hover:text-primary" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Quiz Question UI */}
        {isQuizMode && currentQuestion && !showResult && (
          <div className="animate-fade-in">
            <div className="chat-bubble-ai">
              <div className="mb-3">
                <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">
                  Question {currentQuestionIndex + 1}/{quizQuestions.length}
                </span>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full ml-2">
                  {currentQuestion.difficulty}
                </span>
              </div>
              <p className="font-medium text-lg mb-4">{currentQuestion.question}</p>
              
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
                        className={`w-full text-left p-3 rounded-xl border transition-all ${
                          showFeedback
                            ? isCorrect
                              ? "bg-accent/20 border-accent"
                              : isSelected
                                ? "bg-destructive/20 border-destructive"
                                : "bg-muted border-border"
                            : isSelected
                              ? "bg-primary/20 border-primary"
                              : "bg-muted/50 border-border hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{String.fromCharCode(65 + idx)}. {option}</span>
                          {showFeedback && isCorrect && <CheckCircle className="w-5 h-5 text-accent" />}
                          {showFeedback && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-destructive" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type === "true_false" && (
                <div className="flex gap-3">
                  {["True", "False"].map((option) => {
                    const isSelected = selectedOption === option;
                    const isCorrect = option.toLowerCase() === currentQuestion.correct_answer.toLowerCase();
                    const showFeedback = showExplanation;
                    
                    return (
                      <button
                        key={option}
                        onClick={() => !showExplanation && handleQuizAnswer(option)}
                        disabled={showExplanation}
                        className={`flex-1 p-3 rounded-xl border transition-all ${
                          showFeedback
                            ? isCorrect
                              ? "bg-accent/20 border-accent"
                              : isSelected
                                ? "bg-destructive/20 border-destructive"
                                : "bg-muted border-border"
                            : isSelected
                              ? "bg-primary/20 border-primary"
                              : "bg-muted/50 border-border hover:bg-muted"
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
                  />
                  <Button onClick={() => selectedOption && handleQuizAnswer(selectedOption)} disabled={!selectedOption}>
                    Submit
                  </Button>
                </div>
              )}

              {showExplanation && (
                <div className="mt-4 p-3 bg-muted rounded-xl">
                  <p className="text-sm font-medium mb-1">Correct Answer: {currentQuestion.correct_answer}</p>
                  <p className="text-sm text-muted-foreground">{currentQuestion.explanation}</p>
                  <Button 
                    className="mt-3 w-full" 
                    onClick={handleNextQuestion}
                  >
                    {currentQuestionIndex < quizQuestions.length - 1 ? "Next Question" : "See Results"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        
        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="chat-bubble-ai flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Typing...</span>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview */}
      {selectedImage && (
        <div className="px-4 py-2 bg-secondary/30 border-t border-border">
          <div className="relative inline-block">
            <img src={selectedImage} alt="Preview" className="h-20 rounded-lg" />
            <button
              className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
              onClick={() => setSelectedImage(null)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Input Area - Hide during quiz */}
      {!isQuizMode && (
        <div className="p-4 border-t border-border bg-background">
          <div className="flex items-center gap-2">
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
              className="shrink-0"
            >
              <Image className="w-5 h-5" />
            </Button>
            <Input
              placeholder="Type your message..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1"
              disabled={isLoading}
            />
            <Button
              variant="hero"
              size="icon"
              onClick={handleSendMessage}
              disabled={isLoading || (!inputValue.trim() && !selectedImage)}
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudyChat;