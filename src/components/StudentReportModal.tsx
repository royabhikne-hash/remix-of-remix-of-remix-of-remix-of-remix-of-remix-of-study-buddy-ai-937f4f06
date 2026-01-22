import { useState, useEffect, useRef } from "react"; 
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { ReportSkeleton } from "@/components/DashboardSkeleton";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  ReferenceLine,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BookOpen,
  Brain,
  Target,
  Calendar,
  MessageCircle,
  FileText,
  Loader2,
  Download,
  BarChart3,
  Image,
  Users,
  Award,
  Clock,
  CheckCircle,
  Star,
  Flame,
  Sun,
  Moon,
  Lightbulb,
  GraduationCap,
  Heart,
  Activity,
} from "lucide-react";

interface StudentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  studentPhoto?: string;
  studentClass: string;
  schoolId?: string;
  userType?: "student" | "school" | "admin";
}

interface SessionData {
  id: string;
  topic: string;
  subject: string | null;
  created_at: string;
  understanding_level: string | null;
  time_spent: number | null;
  improvement_score: number | null;
  weak_areas: string[] | null;
  strong_areas: string[] | null;
  ai_summary: string | null;
}

interface QuizData {
  id: string;
  created_at: string;
  accuracy_percentage: number | null;
  correct_count: number;
  total_questions: number;
  understanding_result: string | null;
}

interface ClassAverages {
  avgSessions: number;
  avgTimeSpent: number;
  avgAccuracy: number;
  avgQuizzes: number;
  avgImprovementScore: number;
}

interface SchoolInfo {
  name: string;
  district: string | null;
  state: string | null;
}

const StudentReportModal = ({
  isOpen,
  onClose,
  studentId,
  studentName,
  studentPhoto,
  studentClass,
  schoolId,
  userType = "student",
}: StudentReportModalProps) => {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [quizzes, setQuizzes] = useState<QuizData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [exportingCharts, setExportingCharts] = useState(false);
  const [classAverages, setClassAverages] = useState<ClassAverages | null>(null);
  const [showComparison, setShowComparison] = useState(true);
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const chartsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && studentId) {
      loadStudentData();
    }
  }, [isOpen, studentId]);

  const loadStudentData = async () => {
    setLoading(true);
    try {
      // Use edge function for school/admin to bypass RLS
      if (userType === "school" || userType === "admin") {
        const sessionToken = userType === "admin" 
          ? `admin_${localStorage.getItem("adminId")}_${localStorage.getItem("adminSessionToken")}`
          : localStorage.getItem("schoolSessionToken");
        
        const { data, error } = await supabase.functions.invoke("get-students", {
          body: {
            action: "get_student_report",
            user_type: userType,
            session_token: sessionToken,
            school_id: schoolId || localStorage.getItem("schoolUuid"),
            student_id: studentId,
            student_class: studentClass,
          },
        });

        if (error) {
          console.error("Error fetching student report:", error);
          setLoading(false);
          return;
        }

        if (data?.student?.schools) {
          setSchoolInfo({
            name: data.student.schools.name,
            district: data.student.schools.district,
            state: data.student.schools.state,
          });
        }

        setSessions(data?.sessions || []);
        setQuizzes(data?.quizzes || []);
        
        if (data?.classAverages) {
          setClassAverages(data.classAverages);
        }
      } else {
        // Student viewing own data - use direct Supabase queries
        const { data: studentData } = await supabase
          .from("students")
          .select("*, schools(*)")
          .eq("id", studentId)
          .maybeSingle();

        if (studentData?.schools) {
          setSchoolInfo({
            name: (studentData.schools as any).name,
            district: (studentData.schools as any).district,
            state: (studentData.schools as any).state,
          });
        }

        // Load study sessions from last 7 days with quiz attempts for accurate scoring
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const { data: sessionsData } = await supabase
          .from("study_sessions")
          .select("*, quiz_attempts(accuracy_percentage)")
          .eq("student_id", studentId)
          .gte("created_at", weekAgo.toISOString())
          .order("created_at", { ascending: false });

        const { data: quizzesData } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("student_id", studentId)
          .gte("created_at", weekAgo.toISOString())
          .order("created_at", { ascending: false });

        // Enhance sessions with quiz accuracy as primary score (consistent with edge function)
        const enhancedSessions = (sessionsData || []).map((session: any) => {
          const quizAttempts = session.quiz_attempts as { accuracy_percentage: number | null }[] | null;
          const quizScore = (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null)
            ? quizAttempts[0].accuracy_percentage
            : null;
          
          return {
            ...session,
            improvement_score: quizScore !== null ? quizScore : session.improvement_score,
          };
        });

        setSessions(enhancedSessions);
        setQuizzes(quizzesData || []);

        // Load class averages for comparison
        await loadClassAverages(weekAgo);
      }
    } catch (error) {
      console.error("Error loading student data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadClassAverages = async (weekAgo: Date) => {
    try {
      // Get all students in the same class
      const { data: classStudents } = await supabase
        .from("students")
        .select("id")
        .eq("class", studentClass);

      if (!classStudents || classStudents.length === 0) return;

      const studentIds = classStudents.map((s) => s.id);

      // Get all sessions for these students
      const { data: classSessions } = await supabase
        .from("study_sessions")
        .select("*")
        .in("student_id", studentIds)
        .gte("created_at", weekAgo.toISOString());

      const { data: classQuizzes } = await supabase
        .from("quiz_attempts")
        .select("*")
        .in("student_id", studentIds)
        .gte("created_at", weekAgo.toISOString());

      if (!classSessions && !classQuizzes) return;

      const studentCount = classStudents.length;
      const totalSessions = classSessions?.length || 0;
      const totalQuizzes = classQuizzes?.length || 0;
      const totalTimeSpent = classSessions?.reduce((acc, s) => acc + (s.time_spent || 0), 0) || 0;
      const totalAccuracy = classQuizzes?.reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) || 0;
      const totalImprovementScore = classSessions?.reduce((acc, s) => acc + (s.improvement_score || 50), 0) || 0;

      setClassAverages({
        avgSessions: Math.round((totalSessions / studentCount) * 10) / 10,
        avgTimeSpent: Math.round(totalTimeSpent / studentCount),
        avgAccuracy: totalQuizzes > 0 ? Math.round(totalAccuracy / totalQuizzes) : 0,
        avgQuizzes: Math.round((totalQuizzes / studentCount) * 10) / 10,
        avgImprovementScore: totalSessions > 0 ? Math.round(totalImprovementScore / totalSessions) : 50,
      });
    } catch (error) {
      console.error("Error loading class averages:", error);
    }
  };

  const handleExportCharts = async () => {
    if (!chartsRef.current) return;
    
    setExportingCharts(true);
    try {
      const canvas = await html2canvas(chartsRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      
      const link = document.createElement("a");
      link.download = `${studentName.replace(/\s+/g, "_")}_Charts_${new Date().toISOString().split("T")[0]}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      toast({
        title: "Charts Exported!",
        description: "Performance charts saved as image.",
      });
    } catch (error) {
      console.error("Error exporting charts:", error);
      toast({
        title: "Export Failed",
        description: "Could not export charts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportingCharts(false);
    }
  };

  // Calculate weekly stats
  const weeklyStats = {
    totalSessions: sessions.length,
    totalTimeSpent: sessions.reduce((acc, s) => acc + (s.time_spent || 0), 0),
    avgAccuracy: quizzes.length > 0
      ? Math.round(quizzes.reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) / quizzes.length)
      : 0,
    totalQuizzes: quizzes.length,
    avgImprovementScore: sessions.length > 0
      ? Math.round(sessions.reduce((acc, s) => acc + (s.improvement_score || 50), 0) / sessions.length)
      : 50,
  };

  // Get all weak areas from sessions
  const allWeakAreas = sessions
    .flatMap((s) => s.weak_areas || [])
    .reduce((acc, area) => {
      acc[area] = (acc[area] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topWeakAreas = Object.entries(allWeakAreas)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Get all strong areas from sessions
  const allStrongAreas = sessions
    .flatMap((s) => s.strong_areas || [])
    .reduce((acc, area) => {
      acc[area] = (acc[area] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topStrongAreas = Object.entries(allStrongAreas)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Get subjects studied
  const subjectsStudied = [...new Set(sessions.map((s) => s.subject).filter(Boolean))];

  // Calculate understanding distribution
  const understandingDist = sessions.reduce((acc, s) => {
    const level = s.understanding_level || "average";
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Calculate improvement trend
  const improvementScores = sessions
    .filter((s) => s.improvement_score !== null)
    .map((s) => s.improvement_score!);
  
  let overallTrend: "up" | "down" | "stable" = "stable";
  if (improvementScores.length >= 2) {
    const firstHalf = improvementScores.slice(Math.floor(improvementScores.length / 2));
    const secondHalf = improvementScores.slice(0, Math.floor(improvementScores.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (avgSecond > avgFirst + 5) overallTrend = "up";
    else if (avgSecond < avgFirst - 5) overallTrend = "down";
  }

  // Generate AI feedback summary
  const aiSummaries = sessions
    .filter((s) => s.ai_summary)
    .map((s) => s.ai_summary!)
    .slice(0, 3);

  // ========== NEW DETAILED METRICS ==========
  
  // Daily Breakdown
  const getDailyBreakdown = () => {
    const days: { day: string; date: string; sessions: number; timeSpent: number; quizzes: number; avgScore: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStr = date.toLocaleDateString("en-IN", { weekday: "short" });
      const dateStr = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      
      const daySessions = sessions.filter((s) => {
        const sessionDate = new Date(s.created_at);
        return sessionDate.toDateString() === date.toDateString();
      });
      
      const dayQuizzes = quizzes.filter((q) => {
        const quizDate = new Date(q.created_at);
        return quizDate.toDateString() === date.toDateString();
      });
      
      const avgScore = daySessions.length > 0
        ? Math.round(daySessions.reduce((acc, s) => acc + (s.improvement_score || 50), 0) / daySessions.length)
        : 0;
      
      days.push({
        day: dayStr,
        date: dateStr,
        sessions: daySessions.length,
        timeSpent: daySessions.reduce((acc, s) => acc + (s.time_spent || 0), 0),
        quizzes: dayQuizzes.length,
        avgScore,
      });
    }
    return days;
  };
  
  const dailyBreakdown = getDailyBreakdown();
  
  // Study Streak Calculation
  const calculateStudyStreak = () => {
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    
    for (let i = 0; i <= 6; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const hasSession = sessions.some((s) => {
        const sessionDate = new Date(s.created_at);
        return sessionDate.toDateString() === date.toDateString();
      });
      
      if (hasSession) {
        tempStreak++;
        if (i === 0 || currentStreak > 0) currentStreak++;
      } else {
        if (i === 0) currentStreak = 0;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
        tempStreak = 0;
      }
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;
    
    return { currentStreak, longestStreak };
  };
  
  const studyStreak = calculateStudyStreak();
  
  // Learning Patterns (time of day)
  const getLearningPatterns = () => {
    const patterns = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    
    sessions.forEach((s) => {
      const hour = new Date(s.created_at).getHours();
      if (hour >= 5 && hour < 12) patterns.morning++;
      else if (hour >= 12 && hour < 17) patterns.afternoon++;
      else if (hour >= 17 && hour < 21) patterns.evening++;
      else patterns.night++;
    });
    
    return patterns;
  };
  
  const learningPatterns = getLearningPatterns();
  const preferredStudyTime = Object.entries(learningPatterns).sort((a, b) => b[1] - a[1])[0];
  
  // Topic-wise Performance
  const getTopicPerformance = () => {
    const topicData: Record<string, { sessions: number; avgScore: number; totalScore: number; understanding: string[] }> = {};
    
    sessions.forEach((s) => {
      const topic = s.topic || "General Study";
      if (!topicData[topic]) {
        topicData[topic] = { sessions: 0, avgScore: 0, totalScore: 0, understanding: [] };
      }
      topicData[topic].sessions++;
      topicData[topic].totalScore += s.improvement_score || 50;
      if (s.understanding_level) topicData[topic].understanding.push(s.understanding_level);
    });
    
    return Object.entries(topicData)
      .map(([topic, data]) => ({
        topic,
        sessions: data.sessions,
        avgScore: Math.round(data.totalScore / data.sessions),
        mostCommonUnderstanding: data.understanding.length > 0
          ? data.understanding.sort((a, b) =>
              data.understanding.filter(v => v === b).length - data.understanding.filter(v => v === a).length
            )[0]
          : "average",
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 8);
  };
  
  const topicPerformance = getTopicPerformance();
  
  // Detailed Quiz Analytics
  const getQuizAnalytics = () => {
    if (quizzes.length === 0) return null;
    
    const totalCorrect = quizzes.reduce((acc, q) => acc + q.correct_count, 0);
    const totalQuestions = quizzes.reduce((acc, q) => acc + q.total_questions, 0);
    const avgAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    
    const accuracies = quizzes.map(q => q.accuracy_percentage || 0);
    const bestQuiz = Math.max(...accuracies);
    const worstQuiz = Math.min(...accuracies);
    
    // Performance trend
    let quizTrend: "improving" | "declining" | "stable" = "stable";
    if (quizzes.length >= 2) {
      const recentAvg = quizzes.slice(0, Math.ceil(quizzes.length / 2)).reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) / Math.ceil(quizzes.length / 2);
      const olderAvg = quizzes.slice(Math.ceil(quizzes.length / 2)).reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) / Math.floor(quizzes.length / 2);
      if (recentAvg > olderAvg + 5) quizTrend = "improving";
      else if (recentAvg < olderAvg - 5) quizTrend = "declining";
    }
    
    return {
      totalCorrect,
      totalQuestions,
      avgAccuracy,
      bestQuiz,
      worstQuiz,
      quizTrend,
      passRate: Math.round((quizzes.filter(q => (q.accuracy_percentage || 0) >= 50).length / quizzes.length) * 100),
    };
  };
  
  const quizAnalytics = getQuizAnalytics();
  
  // Generate Personalized Recommendations
  const getRecommendations = () => {
    const recommendations: string[] = [];
    
    if (studyStreak.currentStreak === 0) {
      recommendations.push("🎯 शुरू करें! आज से पढ़ाई शुरू करें और streak बनाएं।");
    } else if (studyStreak.currentStreak < 3) {
      recommendations.push("🔥 बढ़िया! Streak जारी रखें, रोज़ाना पढ़ें।");
    } else {
      recommendations.push("🏆 शानदार! आपकी consistency कमाल की है!");
    }
    
    if (weeklyStats.avgAccuracy < 50) {
      recommendations.push("📖 Quiz accuracy बढ़ाने के लिए topics को दोबारा पढ़ें।");
    } else if (weeklyStats.avgAccuracy >= 70) {
      recommendations.push("⭐ Quiz performance excellent है! ऐसे ही जारी रखें।");
    }
    
    if (topWeakAreas.length > 0) {
      recommendations.push(`⚠️ इन topics पर ध्यान दें: ${topWeakAreas.slice(0, 2).map(([a]) => a).join(", ")}`);
    }
    
    if (weeklyStats.totalTimeSpent < 60) {
      recommendations.push("⏰ Study time बढ़ाएं - कम से कम 30 मिनट रोज़ाना पढ़ें।");
    }
    
    if (preferredStudyTime && preferredStudyTime[1] > 0) {
      const timeLabels: Record<string, string> = {
        morning: "सुबह",
        afternoon: "दोपहर", 
        evening: "शाम",
        night: "रात",
      };
      recommendations.push(`📚 Best study time: ${timeLabels[preferredStudyTime[0]]} - इस समय पढ़ना जारी रखें।`);
    }
    
    return recommendations.slice(0, 5);
  };
  
  const recommendations = getRecommendations();
  
  // Parent Tips
  const parentTips = [
    "👨‍👩‍👧 बच्चे के साथ रोज़ 10 मिनट पढ़ाई की बातें करें।",
    "🌟 छोटी-छोटी उपलब्धियों की तारीफ़ करें।",
    "📱 Screen time को study time में balance करें।",
    "🏠 पढ़ाई के लिए शांत जगह का इंतेज़ाम करें।",
  ];
  
  // Calculate Engagement Score
  const calculateEngagementScore = () => {
    let score = 0;
    
    // Sessions contribution (max 30)
    score += Math.min(30, sessions.length * 5);
    
    // Time contribution (max 25)
    score += Math.min(25, Math.round(weeklyStats.totalTimeSpent / 60) * 2);
    
    // Quiz contribution (max 20)
    score += Math.min(20, weeklyStats.totalQuizzes * 5);
    
    // Streak contribution (max 15)
    score += Math.min(15, studyStreak.currentStreak * 5);
    
    // Accuracy contribution (max 10)
    score += Math.min(10, Math.round(weeklyStats.avgAccuracy / 10));
    
    return score;
  };
  
  const engagementScore = calculateEngagementScore();

  // Chart data preparation
  const getProgressChartData = () => {
    const last7Days: { date: string; score: number; time: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      
      const daySessions = sessions.filter((s) => {
        const sessionDate = new Date(s.created_at);
        return sessionDate.toDateString() === date.toDateString();
      });
      
      const avgScore = daySessions.length > 0
        ? Math.round(daySessions.reduce((acc, s) => acc + (s.improvement_score || 50), 0) / daySessions.length)
        : 0;
      const totalTime = daySessions.reduce((acc, s) => acc + (s.time_spent || 0), 0);
      
      last7Days.push({ date: dateStr, score: avgScore, time: Math.round(totalTime / 60) });
    }
    return last7Days;
  };

  const getSubjectChartData = () => {
    const subjectData: Record<string, { sessions: number; avgScore: number; totalScore: number }> = {};
    sessions.forEach((s) => {
      const subject = s.subject || "General";
      if (!subjectData[subject]) {
        subjectData[subject] = { sessions: 0, avgScore: 0, totalScore: 0 };
      }
      subjectData[subject].sessions++;
      subjectData[subject].totalScore += s.improvement_score || 50;
    });
    
    return Object.entries(subjectData)
      .map(([name, data]) => ({
        name,
        sessions: data.sessions,
        avgScore: Math.round(data.totalScore / data.sessions),
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);
  };

  const getUnderstandingChartData = () => {
    const colors: Record<string, string> = {
      excellent: "#22c55e",
      good: "#3b82f6",
      average: "#f59e0b",
      weak: "#ef4444",
    };
    
    return Object.entries(understandingDist).map(([level, count]) => ({
      name: level.charAt(0).toUpperCase() + level.slice(1),
      value: count,
      color: colors[level] || "#6b7280",
    }));
  };

  // Skill radar chart data
  const getSkillRadarData = () => {
    const consistency = sessions.length > 0 ? Math.min(100, sessions.length * 15) : 0;
    const accuracy = weeklyStats.avgAccuracy;
    const engagement = Math.min(100, (weeklyStats.totalTimeSpent / 60) * 2);
    const quizPerformance = quizzes.length > 0 
      ? Math.round(quizzes.reduce((acc, q) => acc + ((q.correct_count / q.total_questions) * 100), 0) / quizzes.length)
      : 0;
    const improvement = weeklyStats.avgImprovementScore;

    return [
      { skill: "Consistency", value: consistency, fullMark: 100 },
      { skill: "Accuracy", value: accuracy, fullMark: 100 },
      { skill: "Engagement", value: engagement, fullMark: 100 },
      { skill: "Quiz Score", value: quizPerformance, fullMark: 100 },
      { skill: "Improvement", value: improvement, fullMark: 100 },
    ];
  };

  const progressData = getProgressChartData();
  const subjectData = getSubjectChartData();
  const understandingChartData = getUnderstandingChartData();
  const skillRadarData = getSkillRadarData();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate overall grade
  const calculateGrade = () => {
    const score = (weeklyStats.avgImprovementScore * 0.4) + (weeklyStats.avgAccuracy * 0.3) + (sessions.length * 5 * 0.3);
    if (score >= 85) return { grade: "A+", color: "#22c55e", label: "Excellent" };
    if (score >= 75) return { grade: "A", color: "#22c55e", label: "Very Good" };
    if (score >= 65) return { grade: "B+", color: "#3b82f6", label: "Good" };
    if (score >= 55) return { grade: "B", color: "#3b82f6", label: "Above Average" };
    if (score >= 45) return { grade: "C", color: "#f59e0b", label: "Average" };
    return { grade: "D", color: "#ef4444", label: "Needs Improvement" };
  };

  const gradeInfo = calculateGrade();

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yPos = 15;
      const lineHeight = 6;
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      // Helper function to add new page if needed
      const checkPageBreak = (requiredSpace: number) => {
        if (yPos + requiredSpace > pageHeight - 25) {
          pdf.addPage();
          yPos = 20;
          // Add header on new page
          pdf.setFontSize(8);
          pdf.setTextColor(128, 128, 128);
          pdf.text("Edu Improvement AI - Student Progress Report", margin, 10);
          pdf.text(`Page ${pdf.getNumberOfPages()}`, pageWidth - margin, 10, { align: "right" });
          pdf.setTextColor(0, 0, 0);
        }
      };

      // Header with branding
      pdf.setFillColor(59, 130, 246); // Primary blue
      pdf.rect(0, 0, pageWidth, 35, "F");
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(22);
      pdf.setFont("helvetica", "bold");
      pdf.text("Edu Improvement AI", margin, 15);
      
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.text("Weekly Progress Report", margin, 23);
      
      // School info on header
      if (schoolInfo) {
        pdf.setFontSize(10);
        pdf.text(schoolInfo.name, pageWidth - margin, 15, { align: "right" });
        pdf.setFontSize(8);
        pdf.text(`${schoolInfo.district || ""}, ${schoolInfo.state || ""}`, pageWidth - margin, 21, { align: "right" });
      }

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(8);
      pdf.text(`Generated: ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`, margin, 31);

      yPos = 45;
      pdf.setTextColor(0, 0, 0);

      // Student Info Card
      pdf.setFillColor(245, 247, 250);
      pdf.roundedRect(margin, yPos, contentWidth, 28, 3, 3, "F");
      
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text(studentName, margin + 5, yPos + 10);
      
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 100, 100);
      pdf.text(`Class: ${studentClass}`, margin + 5, yPos + 18);
      pdf.text(`Report Period: Last 7 Days`, margin + 5, yPos + 24);

      // Grade badge
      pdf.setFillColor(
        gradeInfo.color === "#22c55e" ? 34 : gradeInfo.color === "#3b82f6" ? 59 : gradeInfo.color === "#f59e0b" ? 245 : 239,
        gradeInfo.color === "#22c55e" ? 197 : gradeInfo.color === "#3b82f6" ? 130 : gradeInfo.color === "#f59e0b" ? 158 : 68,
        gradeInfo.color === "#22c55e" ? 94 : gradeInfo.color === "#3b82f6" ? 246 : gradeInfo.color === "#f59e0b" ? 11 : 68
      );
      pdf.circle(pageWidth - margin - 15, yPos + 14, 12, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(gradeInfo.grade, pageWidth - margin - 15, yPos + 18, { align: "center" });
      
      pdf.setTextColor(0, 0, 0);
      pdf.setFontSize(8);
      pdf.text(gradeInfo.label, pageWidth - margin - 15, yPos + 26, { align: "center" });

      yPos += 35;

      // Overall Trend Banner
      const trendColor = overallTrend === "up" ? { r: 34, g: 197, b: 94 } : overallTrend === "down" ? { r: 239, g: 68, b: 68 } : { r: 156, g: 163, b: 175 };
      pdf.setFillColor(trendColor.r, trendColor.g, trendColor.b);
      pdf.roundedRect(margin, yPos, contentWidth, 12, 2, 2, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      const trendText = overallTrend === "up" ? "📈 IMPROVING - Keep up the great work!" : overallTrend === "down" ? "📉 DECLINING - Needs more focus" : "➡️ STABLE - Consistent performance";
      pdf.text(trendText, pageWidth / 2, yPos + 8, { align: "center" });
      
      yPos += 18;
      pdf.setTextColor(0, 0, 0);

      // Weekly Summary Section
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("Weekly Summary", margin, yPos);
      yPos += 8;

      // Stats boxes
      const boxWidth = (contentWidth - 15) / 4;
      const stats = [
        { label: "Sessions", value: weeklyStats.totalSessions.toString(), color: { r: 59, g: 130, b: 246 } },
        { label: "Study Time", value: `${Math.round(weeklyStats.totalTimeSpent / 60)}m`, color: { r: 34, g: 197, b: 94 } },
        { label: "Quizzes", value: weeklyStats.totalQuizzes.toString(), color: { r: 168, g: 85, b: 247 } },
        { label: "Accuracy", value: `${weeklyStats.avgAccuracy}%`, color: { r: 245, g: 158, b: 11 } },
      ];

      stats.forEach((stat, i) => {
        const x = margin + (boxWidth + 5) * i;
        pdf.setFillColor(stat.color.r, stat.color.g, stat.color.b);
        pdf.roundedRect(x, yPos, boxWidth, 22, 2, 2, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text(stat.value, x + boxWidth / 2, yPos + 10, { align: "center" });
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text(stat.label, x + boxWidth / 2, yPos + 18, { align: "center" });
      });

      yPos += 30;
      pdf.setTextColor(0, 0, 0);

      // Class Comparison
      if (classAverages) {
        checkPageBreak(25);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Comparison with Class Average", margin, yPos);
        yPos += 7;
        
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        
        const comparisons = [
          { label: "Sessions", student: weeklyStats.totalSessions, classAvg: classAverages.avgSessions },
          { label: "Study Time (min)", student: Math.round(weeklyStats.totalTimeSpent / 60), classAvg: Math.round(classAverages.avgTimeSpent / 60) },
          { label: "Accuracy", student: weeklyStats.avgAccuracy, classAvg: classAverages.avgAccuracy },
        ];

        comparisons.forEach((comp) => {
          const isAbove = comp.student >= comp.classAvg;
          pdf.setTextColor(isAbove ? 34 : 239, isAbove ? 197 : 68, isAbove ? 94 : 68);
          const symbol = isAbove ? "▲" : "▼";
          pdf.text(`${symbol} ${comp.label}: ${comp.student} (Class Avg: ${comp.classAvg})`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Subjects Studied
      if (subjectsStudied.length > 0) {
        checkPageBreak(18);
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Subjects Studied", margin, yPos);
        yPos += 7;
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(subjectsStudied.join(" • "), margin + 5, yPos);
        yPos += 10;
      }

      // Understanding Levels
      if (Object.keys(understandingDist).length > 0) {
        checkPageBreak(25);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Understanding Levels", margin, yPos);
        yPos += 7;
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        Object.entries(understandingDist).forEach(([level, count]) => {
          const levelColors: Record<string, { r: number; g: number; b: number }> = {
            excellent: { r: 34, g: 197, b: 94 },
            good: { r: 59, g: 130, b: 246 },
            average: { r: 245, g: 158, b: 11 },
            weak: { r: 239, g: 68, b: 68 },
          };
          const color = levelColors[level] || { r: 100, g: 100, b: 100 };
          pdf.setTextColor(color.r, color.g, color.b);
          pdf.text(`● ${level.charAt(0).toUpperCase() + level.slice(1)}: ${count} session(s)`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Weak Areas
      if (topWeakAreas.length > 0) {
        checkPageBreak(30);
        pdf.setTextColor(239, 68, 68);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("⚠ Areas Needing Improvement", margin, yPos);
        yPos += 7;
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        topWeakAreas.forEach(([area, count]) => {
          pdf.text(`• ${area} (identified in ${count} session${count > 1 ? "s" : ""})`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Strong Areas
      if (topStrongAreas.length > 0) {
        checkPageBreak(30);
        pdf.setTextColor(34, 197, 94);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("✓ Strong Areas", margin, yPos);
        yPos += 7;
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        topStrongAreas.forEach(([area, count]) => {
          pdf.text(`• ${area} (demonstrated in ${count} session${count > 1 ? "s" : ""})`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Recent Quiz Results
      if (quizzes.length > 0) {
        checkPageBreak(40);
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Recent Quiz Results", margin, yPos);
        yPos += 7;
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        quizzes.slice(0, 5).forEach((quiz) => {
          checkPageBreak(lineHeight);
          const date = new Date(quiz.created_at).toLocaleDateString("en-IN");
          const percentage = quiz.accuracy_percentage?.toFixed(0) || 0;
          const color = Number(percentage) >= 70 ? { r: 34, g: 197, b: 94 } : Number(percentage) >= 50 ? { r: 245, g: 158, b: 11 } : { r: 239, g: 68, b: 68 };
          pdf.setTextColor(color.r, color.g, color.b);
          pdf.text(`${date}: ${quiz.correct_count}/${quiz.total_questions} correct (${percentage}%)`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // AI Feedback
      if (aiSummaries.length > 0) {
        checkPageBreak(40);
        pdf.setTextColor(59, 130, 246);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("AI Study Feedback", margin, yPos);
        yPos += 7;
        pdf.setTextColor(80, 80, 80);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "italic");
        aiSummaries.forEach((summary) => {
          checkPageBreak(20);
          const lines = pdf.splitTextToSize(`"${summary}"`, contentWidth - 10);
          lines.forEach((line: string) => {
            pdf.text(line, margin + 5, yPos);
            yPos += 4.5;
          });
          yPos += 3;
        });
      }

      // Footer
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFillColor(59, 130, 246);
        pdf.rect(0, pageHeight - 15, pageWidth, 15, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text("Generated by Edu Improvement AI | Your Personal Study Buddy", pageWidth / 2, pageHeight - 7, { align: "center" });
        pdf.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: "right" });
        if (schoolInfo) {
          pdf.text(schoolInfo.name, margin, pageHeight - 7);
        }
      }

      // Save PDF
      const fileName = `${studentName.replace(/\s+/g, "_")}_Report_${new Date().toISOString().split("T")[0]}.pdf`;
      pdf.save(fileName);

      toast({
        title: "PDF Downloaded!",
        description: `Report saved as ${fileName}`,
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        title: "Download Failed",
        description: "Could not generate PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const getUnderstandingColor = (level: string) => {
    switch (level) {
      case "excellent":
        return "bg-accent text-accent-foreground";
      case "good":
        return "bg-primary text-primary-foreground";
      case "average":
        return "bg-secondary text-secondary-foreground";
      case "weak":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden bg-gradient-to-b from-background to-muted/20">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-gradient-to-br from-primary/5 via-accent/5 to-background relative overflow-hidden">
          {/* Decorative background */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-accent/20 rounded-full blur-2xl" />
          </div>
          
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              {studentPhoto ? (
                <div className="relative">
                  <img
                    src={studentPhoto}
                    alt={studentName}
                    className="w-20 h-20 rounded-2xl object-cover border-4 border-background shadow-lg"
                  />
                  <div 
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg"
                    style={{ backgroundColor: gradeInfo.color }}
                  >
                    {gradeInfo.grade}
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl font-bold text-primary-foreground shadow-lg">
                    {studentName.charAt(0)}
                  </div>
                  <div 
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg"
                    style={{ backgroundColor: gradeInfo.color }}
                  >
                    {gradeInfo.grade}
                  </div>
                </div>
              )}
              <div className="min-w-0">
                <DialogTitle className="text-xl sm:text-2xl font-bold truncate">{studentName}</DialogTitle>
                <p className="text-muted-foreground font-medium text-sm sm:text-base">
                  {studentClass.startsWith("Class") ? studentClass : `Class ${studentClass}`}
                </p>
                {schoolInfo && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{schoolInfo.name}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {overallTrend === "up" && (
                <span className="inline-flex items-center gap-1 px-2 sm:px-4 py-1 sm:py-2 rounded-xl bg-accent/20 text-accent text-xs sm:text-sm font-semibold shadow-sm">
                  <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" /> Improving
                </span>
              )}
              {overallTrend === "down" && (
                <span className="inline-flex items-center gap-1 px-2 sm:px-4 py-1 sm:py-2 rounded-xl bg-destructive/20 text-destructive text-xs sm:text-sm font-semibold shadow-sm">
                  <TrendingDown className="w-3 h-3 sm:w-4 sm:h-4" /> Declining
                </span>
              )}
              {overallTrend === "stable" && (
                <span className="inline-flex items-center gap-1 px-2 sm:px-4 py-1 sm:py-2 rounded-xl bg-muted text-muted-foreground text-xs sm:text-sm font-semibold shadow-sm">
                  <Minus className="w-3 h-3 sm:w-4 sm:h-4" /> Stable
                </span>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || loading}
                className="rounded-xl shadow-sm text-xs sm:text-sm"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Download</span> PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-140px)]">
          {loading ? (
            <ReportSkeleton />
          ) : (
            <div className="p-6 space-y-8">
              {/* Weekly Summary Stats with Class Comparison */}
              <div>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary" />
                    Weekly Summary (Last 7 Days)
                  </h3>
                  {classAverages && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowComparison(!showComparison)}
                      className="flex items-center gap-2 rounded-xl"
                    >
                      <Users className="w-4 h-4" />
                      {showComparison ? "Hide" : "Show"} Class Avg
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
                  <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl p-3 sm:p-5 text-center border border-primary/20 shadow-sm">
                    <p className="text-2xl sm:text-4xl font-bold text-primary mb-1">{weeklyStats.totalSessions}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">Sessions</p>
                    {showComparison && classAverages && (
                      <div className="mt-2 text-xs">
                        <span className={`font-medium ${weeklyStats.totalSessions >= classAverages.avgSessions ? "text-accent" : "text-destructive"}`}>
                          Class Avg: {classAverages.avgSessions}
                          {weeklyStats.totalSessions >= classAverages.avgSessions ? " ↑" : " ↓"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-gradient-to-br from-accent/10 to-accent/5 rounded-2xl p-3 sm:p-5 text-center border border-accent/20 shadow-sm">
                    <p className="text-2xl sm:text-4xl font-bold text-accent mb-1">
                      {Math.round(weeklyStats.totalTimeSpent / 60)}m
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">Time</p>
                    {showComparison && classAverages && (
                      <div className="mt-2 text-xs">
                        <span className={`font-medium ${weeklyStats.totalTimeSpent >= classAverages.avgTimeSpent ? "text-accent" : "text-destructive"}`}>
                          Class Avg: {Math.round(classAverages.avgTimeSpent / 60)}m
                          {weeklyStats.totalTimeSpent >= classAverages.avgTimeSpent ? " ↑" : " ↓"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 rounded-2xl p-3 sm:p-5 text-center border border-purple-500/20 shadow-sm">
                    <p className="text-2xl sm:text-4xl font-bold text-purple-500 mb-1">{weeklyStats.totalQuizzes}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">Quizzes</p>
                    {showComparison && classAverages && (
                      <div className="mt-2 text-xs">
                        <span className={`font-medium ${weeklyStats.totalQuizzes >= classAverages.avgQuizzes ? "text-accent" : "text-destructive"}`}>
                          Class Avg: {classAverages.avgQuizzes}
                          {weeklyStats.totalQuizzes >= classAverages.avgQuizzes ? " ↑" : " ↓"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 rounded-2xl p-3 sm:p-5 text-center border border-orange-500/20 shadow-sm">
                    <p className="text-2xl sm:text-4xl font-bold text-orange-500 mb-1">{weeklyStats.avgAccuracy}%</p>
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">Accuracy</p>
                    {showComparison && classAverages && (
                      <div className="mt-2 text-xs">
                        <span className={`font-medium ${weeklyStats.avgAccuracy >= classAverages.avgAccuracy ? "text-accent" : "text-destructive"}`}>
                          Class Avg: {classAverages.avgAccuracy}%
                          {weeklyStats.avgAccuracy >= classAverages.avgAccuracy ? " ↑" : " ↓"}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="bg-gradient-to-br from-background to-muted/50 rounded-2xl p-3 sm:p-5 text-center border border-border shadow-sm col-span-2 sm:col-span-1">
                    <div 
                      className="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-md"
                      style={{ backgroundColor: gradeInfo.color }}
                    >
                      {gradeInfo.grade}
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground font-medium">{gradeInfo.label}</p>
                  </div>
                </div>
              </div>

              {/* What Child Studied This Week - Detailed Breakdown */}
              {sessions.length > 0 && (
                <div className="bg-gradient-to-br from-indigo-500/10 via-blue-500/10 to-cyan-500/10 rounded-2xl p-5 border border-indigo-500/20">
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <FileText className="w-5 h-5 text-indigo-500" />
                    इस हफ्ते बच्चे ने क्या पढ़ा (What Child Studied This Week)
                  </h3>
                  
                  {/* Total Study Summary */}
                  <div className="bg-background/50 rounded-xl p-4 mb-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-primary">{sessions.length}</p>
                        <p className="text-xs text-muted-foreground">कुल sessions</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-accent">{Math.round(weeklyStats.totalTimeSpent / 60)}</p>
                        <p className="text-xs text-muted-foreground">कुल मिनट</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-purple-500">{subjectsStudied.length}</p>
                        <p className="text-xs text-muted-foreground">विषय पढ़े</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Detailed Session Log */}
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    <p className="text-sm font-medium text-muted-foreground mb-2">हर session की detail:</p>
                    {sessions.slice(0, 10).map((session, i) => {
                      const sessionDate = new Date(session.created_at);
                      const dayName = sessionDate.toLocaleDateString("hi-IN", { weekday: "short" });
                      const dateStr = sessionDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
                      const timeStr = sessionDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                      
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 bg-background/70 rounded-xl border border-border/50">
                          <div className="flex-shrink-0 w-12 text-center">
                            <p className="text-xs font-medium text-muted-foreground">{dayName}</p>
                            <p className="text-sm font-bold">{dateStr}</p>
                            <p className="text-[10px] text-muted-foreground">{timeStr}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium text-sm truncate">{session.topic || session.subject || "General Study"}</p>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getUnderstandingColor(session.understanding_level || "average")}`}>
                                {session.understanding_level || "average"}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {session.time_spent || 0} min
                              </span>
                              <span className="flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                Score: {session.improvement_score || 50}%
                              </span>
                            </div>
                            {session.ai_summary && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                                "{session.ai_summary}"
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {sessions.length > 10 && (
                      <p className="text-xs text-center text-muted-foreground py-2">
                        +{sessions.length - 10} more sessions...
                      </p>
                    )}
                  </div>
                  
                  {/* Topics Covered Summary */}
                  {topicPerformance.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <p className="text-sm font-medium mb-2">Topics covered summary:</p>
                      <div className="flex flex-wrap gap-2">
                        {topicPerformance.map((topic, i) => (
                          <span 
                            key={i} 
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-xs"
                          >
                            <span className="font-medium">{topic.topic}</span>
                            <span className="text-muted-foreground">({topic.sessions}x, {topic.avgScore}%)</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-6">
                {/* Study Streak Card */}
                <div className="bg-gradient-to-br from-orange-500/10 via-red-500/10 to-pink-500/10 rounded-2xl p-5 border border-orange-500/20">
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <Flame className="w-5 h-5 text-orange-500" />
                    Study Streak
                  </h3>
                  <div className="flex items-center justify-around">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mx-auto mb-2">
                        <span className="text-2xl font-bold text-white">{studyStreak.currentStreak}</span>
                      </div>
                      <p className="text-sm text-muted-foreground font-medium">Current Streak</p>
                      <p className="text-xs text-muted-foreground">days</p>
                    </div>
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center mx-auto mb-2">
                        <span className="text-2xl font-bold text-white">{studyStreak.longestStreak}</span>
                      </div>
                      <p className="text-sm text-muted-foreground font-medium">Best Streak</p>
                      <p className="text-xs text-muted-foreground">this week</p>
                    </div>
                  </div>
                  {studyStreak.currentStreak >= 3 && (
                    <div className="mt-4 text-center">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-orange-500/20 text-orange-600 text-sm font-medium">
                        🔥 On Fire! Keep it up!
                      </span>
                    </div>
                  )}
                </div>

                {/* Engagement Score */}
                <div className="bg-gradient-to-br from-primary/10 via-accent/10 to-purple-500/10 rounded-2xl p-5 border border-primary/20">
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-primary" />
                    Engagement Score
                  </h3>
                  <div className="relative flex items-center justify-center">
                    <div className="w-28 h-28 relative">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke="hsl(var(--muted))"
                          strokeWidth="10"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth="10"
                          strokeDasharray={`${engagementScore * 2.51} 251`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-primary">{engagementScore}</span>
                        <span className="text-xs text-muted-foreground">/100</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-center mt-3 text-sm text-muted-foreground">
                    {engagementScore >= 80 ? "🌟 Excellent Engagement!" : 
                     engagementScore >= 60 ? "👍 Good Engagement" : 
                     engagementScore >= 40 ? "💪 Keep Improving" : "🎯 Room to Grow"}
                  </p>
                </div>
              </div>

              {/* Daily Breakdown */}
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <Calendar className="w-5 h-5 text-primary" />
                  Daily Breakdown (पिछले 7 दिन)
                </h3>
                <div className="grid grid-cols-7 gap-2">
                  {dailyBreakdown.map((day, i) => (
                    <div 
                      key={i}
                      className={`rounded-xl p-3 text-center transition-all ${
                        day.sessions > 0 
                          ? "bg-gradient-to-br from-accent/20 to-accent/10 border border-accent/30" 
                          : "bg-muted/50 border border-border"
                      }`}
                    >
                      <p className="text-xs font-medium text-muted-foreground">{day.day}</p>
                      <p className="text-[10px] text-muted-foreground">{day.date}</p>
                      <div className="mt-2">
                        {day.sessions > 0 ? (
                          <>
                            <p className="text-lg font-bold text-accent">{day.sessions}</p>
                            <p className="text-[10px] text-muted-foreground">sessions</p>
                            {day.timeSpent > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {Math.round(day.timeSpent / 60)}m
                              </p>
                            )}
                          </>
                        ) : (
                          <div className="h-8 flex items-center justify-center">
                            <span className="text-muted-foreground text-lg">-</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Learning Patterns */}
              <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-2xl p-5 border border-blue-500/20">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-blue-500" />
                  Learning Patterns (पढ़ाई का समय)
                </h3>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { key: "morning", label: "Morning", subLabel: "सुबह (5-12)", icon: Sun, color: "text-yellow-500" },
                    { key: "afternoon", label: "Afternoon", subLabel: "दोपहर (12-5)", icon: Sun, color: "text-orange-500" },
                    { key: "evening", label: "Evening", subLabel: "शाम (5-9)", icon: Moon, color: "text-purple-500" },
                    { key: "night", label: "Night", subLabel: "रात (9-5)", icon: Moon, color: "text-blue-500" },
                  ].map(({ key, label, subLabel, icon: Icon, color }) => (
                    <div 
                      key={key}
                      className={`rounded-xl p-3 text-center ${
                        preferredStudyTime[0] === key ? "bg-primary/20 border-2 border-primary" : "bg-background/50"
                      }`}
                    >
                      <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
                      <p className="text-xs font-medium">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{subLabel}</p>
                      <p className="text-lg font-bold mt-1">{learningPatterns[key as keyof typeof learningPatterns]}</p>
                      <p className="text-[10px] text-muted-foreground">sessions</p>
                    </div>
                  ))}
                </div>
                {preferredStudyTime[1] > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-background/50 text-center">
                    <p className="text-sm">
                      <span className="font-medium">Best Study Time:</span>{" "}
                      <span className="text-primary font-bold capitalize">{preferredStudyTime[0]}</span>
                      <span className="text-muted-foreground"> ({preferredStudyTime[1]} sessions)</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Quiz Analytics */}
              {quizAnalytics && (
                <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-2xl p-5 border border-purple-500/20">
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <GraduationCap className="w-5 h-5 text-purple-500" />
                    Detailed Quiz Analytics
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-background/50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-primary">{quizAnalytics.totalCorrect}</p>
                      <p className="text-xs text-muted-foreground">Total Correct</p>
                      <p className="text-[10px] text-muted-foreground">out of {quizAnalytics.totalQuestions}</p>
                    </div>
                    <div className="bg-background/50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-accent">{quizAnalytics.avgAccuracy}%</p>
                      <p className="text-xs text-muted-foreground">Avg Accuracy</p>
                    </div>
                    <div className="bg-background/50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-green-500">{quizAnalytics.bestQuiz}%</p>
                      <p className="text-xs text-muted-foreground">Best Quiz</p>
                    </div>
                    <div className="bg-background/50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-orange-500">{quizAnalytics.passRate}%</p>
                      <p className="text-xs text-muted-foreground">Pass Rate (≥50%)</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                      quizAnalytics.quizTrend === "improving" ? "bg-accent/20 text-accent" :
                      quizAnalytics.quizTrend === "declining" ? "bg-destructive/20 text-destructive" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {quizAnalytics.quizTrend === "improving" ? "📈 Improving" :
                       quizAnalytics.quizTrend === "declining" ? "📉 Needs Focus" :
                       "➡️ Stable"}
                    </span>
                  </div>
                </div>
              )}

              {/* Topic-wise Performance */}
              {topicPerformance.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <BookOpen className="w-5 h-5 text-primary" />
                    Topic-wise Performance
                  </h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {topicPerformance.map((topic, i) => (
                      <div key={i} className="bg-gradient-to-r from-muted/50 to-transparent rounded-xl p-4 border border-border/50">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-sm truncate flex-1">{topic.topic}</h4>
                          <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${getUnderstandingColor(topic.mostCommonUnderstanding)}`}>
                            {topic.mostCommonUnderstanding}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{topic.sessions} sessions</span>
                          <span>Avg Score: {topic.avgScore}%</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                          <div 
                            className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                            style={{ width: `${topic.avgScore}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-2xl p-5 border border-green-500/20">
                  <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <Lightbulb className="w-5 h-5 text-green-500" />
                    AI Recommendations (सुझाव)
                  </h3>
                  <div className="space-y-3">
                    {recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-background/50 rounded-xl">
                        <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-green-600">{i + 1}</span>
                        </div>
                        <p className="text-sm">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parent Tips */}
              <div className="bg-gradient-to-br from-pink-500/10 to-rose-500/10 rounded-2xl p-5 border border-pink-500/20">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <Heart className="w-5 h-5 text-pink-500" />
                  Tips for Parents (माता-पिता के लिए)
                </h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {parentTips.map((tip, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-background/50 rounded-xl">
                      <p className="text-sm">{tip}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance Charts Section */}
              {sessions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      Performance Analytics
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportCharts}
                      disabled={exportingCharts}
                      className="flex items-center gap-2 rounded-xl"
                    >
                      {exportingCharts ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Image className="w-4 h-4" />
                          Export Charts
                        </>
                      )}
                    </Button>
                  </div>
                  
                  {/* Charts container with ref for export */}
                  <div ref={chartsRef} className="bg-gradient-to-br from-background to-muted/30 p-4 rounded-2xl border border-border/50">
                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      {/* Progress Over Time Chart */}
                      <div className="edu-card p-4">
                        <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Progress Over Time (7 Days)
                        </h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <AreaChart data={progressData}>
                            <defs>
                              <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                              }}
                              labelStyle={{ color: "hsl(var(--foreground))" }}
                            />
                            {showComparison && classAverages && (
                              <ReferenceLine 
                                y={classAverages.avgImprovementScore} 
                                stroke="hsl(var(--destructive))"
                                strokeDasharray="5 5"
                                label={{ value: "Class Avg", position: "right", fontSize: 10, fill: "hsl(var(--destructive))" }}
                              />
                            )}
                            <Area
                              type="monotone"
                              dataKey="score"
                              stroke="hsl(var(--primary))"
                              fillOpacity={1}
                              fill="url(#scoreGradient)"
                              strokeWidth={2}
                              name="Avg Score"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Skill Radar Chart */}
                      <div className="edu-card p-4">
                        <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                          <Star className="w-4 h-4" />
                          Skill Assessment
                        </h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <RadarChart data={skillRadarData}>
                            <PolarGrid stroke="hsl(var(--border))" />
                            <PolarAngleAxis dataKey="skill" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8 }} />
                            <Radar
                              name="Skills"
                              dataKey="value"
                              stroke="hsl(var(--primary))"
                              fill="hsl(var(--primary))"
                              fillOpacity={0.4}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                              }}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Understanding Distribution Pie Chart */}
                      {understandingChartData.length > 0 && (
                        <div className="edu-card p-4">
                          <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                            <Brain className="w-4 h-4" />
                            Understanding Distribution
                          </h4>
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie
                                data={understandingChartData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={70}
                                paddingAngle={3}
                                dataKey="value"
                              >
                                {understandingChartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                }}
                              />
                              <Legend
                                formatter={(value) => <span className="text-foreground text-xs">{value}</span>}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Subject Performance Bar Chart */}
                      {subjectData.length > 0 && (
                        <div className="edu-card p-4">
                          <h4 className="text-sm font-medium mb-3 text-muted-foreground flex items-center gap-2">
                            <BookOpen className="w-4 h-4" />
                            Subject Performance
                          </h4>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={subjectData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                }}
                                labelStyle={{ color: "hsl(var(--foreground))" }}
                              />
                              <Bar dataKey="avgScore" fill="hsl(var(--accent))" name="Avg Score" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Subjects Studied */}
              {subjectsStudied.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-primary" />
                    Subjects Studied
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {subjectsStudied.map((subject, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-sm"
                      >
                        {subject}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Understanding Levels */}
              {Object.keys(understandingDist).length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    Understanding Levels
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(understandingDist).map(([level, count]) => (
                      <span
                        key={level}
                        className={`px-3 py-1 rounded-full text-sm capitalize ${getUnderstandingColor(level)}`}
                      >
                        {level}: {count} sessions
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Weak & Strong Areas */}
              <div className="grid md:grid-cols-2 gap-6">
                {topStrongAreas.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-accent" />
                      Strong Areas
                    </h3>
                    <div className="space-y-2">
                      {topStrongAreas.map(([area, count], i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 bg-accent/10 rounded-lg"
                        >
                          <span className="font-medium">{area}</span>
                          <span className="text-sm text-muted-foreground">{count} sessions</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {topWeakAreas.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-destructive" />
                      Needs Improvement
                    </h3>
                    <div className="space-y-2">
                      {topWeakAreas.map(([area, count], i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 bg-destructive/10 rounded-lg"
                        >
                          <span className="font-medium">{area}</span>
                          <span className="text-sm text-muted-foreground">{count} sessions</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Recent Quiz Results */}
              {quizzes.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Award className="w-5 h-5 text-primary" />
                    Recent Quiz Results
                  </h3>
                  <div className="space-y-2">
                    {quizzes.slice(0, 5).map((quiz) => (
                      <div
                        key={quiz.id}
                        className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{formatDate(quiz.created_at)}</p>
                            <p className="text-sm text-muted-foreground">
                              {quiz.understanding_result || "Quiz completed"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">
                            {quiz.correct_count}/{quiz.total_questions}
                          </p>
                          <p className={`text-sm font-medium ${
                            (quiz.accuracy_percentage || 0) >= 70 ? "text-accent" : 
                            (quiz.accuracy_percentage || 0) >= 50 ? "text-yellow-500" : "text-destructive"
                          }`}>
                            {quiz.accuracy_percentage?.toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Feedback Summary */}
              {aiSummaries.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-primary" />
                    AI Feedback Summary
                  </h3>
                  <div className="space-y-3">
                    {aiSummaries.map((summary, i) => (
                      <div
                        key={i}
                        className="p-4 bg-muted/50 rounded-lg border-l-4 border-primary"
                      >
                        <p className="text-sm italic text-muted-foreground">"{summary}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Data State */}
              {sessions.length === 0 && quizzes.length === 0 && (
                <div className="text-center py-12">
                  <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-semibold mb-2">No Data This Week</h3>
                  <p className="text-muted-foreground">
                    This student hasn't completed any study sessions in the last 7 days.
                  </p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default StudentReportModal;