import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  Target,
  Brain,
  BarChart3,
  Award,
  Flame,
  Zap,
  Star,
  CheckCircle,
  Download,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageToggle from "@/components/LanguageToggle";
import jsPDF from "jspdf";
import { ProgressSkeleton } from "@/components/DashboardSkeleton";
import {
  LineChart,
  Line,
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
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ComposedChart,
  Legend,
} from "recharts";

interface StudySession {
  id: string;
  topic: string;
  subject: string | null;
  time_spent: number | null;
  improvement_score: number | null;
  understanding_level: string | null;
  weak_areas: string[] | null;
  strong_areas: string[] | null;
  created_at: string;
}

interface QuizAttempt {
  id: string;
  accuracy_percentage: number | null;
  correct_count: number;
  total_questions: number;
  created_at: string;
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#8b5cf6", "#f59e0b", "#ef4444"];

const StudentProgress = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [quizzes, setQuizzes] = useState<QuizAttempt[]>([]);
  const [studentName, setStudentName] = useState("Student");
  const [studentClass, setStudentClass] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
      return;
    }

    if (user) {
      loadProgressData();
    }
  }, [user, loading, navigate]);

  const loadProgressData = async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      const { data: student } = await supabase
        .from("students")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (student) {
        setStudentName(student.full_name);
        setStudentClass(student.class);

        const { data: sessionData } = await supabase
          .from("study_sessions")
          .select("*, quiz_attempts(accuracy_percentage)")
          .eq("student_id", student.id)
          .not("time_spent", "eq", 0)  // Only get completed sessions
          .order("created_at", { ascending: true });

        const { data: quizData } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("student_id", student.id)
          .order("created_at", { ascending: false });

        if (sessionData) {
          // Enhance sessions with quiz accuracy as the primary score
          const enhancedSessions = sessionData.map(session => {
            const quizAttempts = (session as any).quiz_attempts as { accuracy_percentage: number | null }[] | null;
            const quizScore = (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null)
              ? quizAttempts[0].accuracy_percentage
              : null;
            
            return {
              ...session,
              improvement_score: quizScore !== null ? quizScore : session.improvement_score,
            };
          });
          setSessions(enhancedSessions);
        }
        if (quizData) {
          setQuizzes(quizData);
        }
      }
    } catch (error) {
      console.error("Error loading progress data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate improvement over time data (last 30 days)
  const getImprovementData = () => {
    const last30Days = sessions.filter(s => {
      const date = new Date(s.created_at);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return date >= thirtyDaysAgo;
    });

    // Group by date
    const grouped = last30Days.reduce((acc, session) => {
      const date = new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!acc[date]) {
        acc[date] = { scores: [], time: 0 };
      }
      // Only include sessions with actual scores (not default 50)
      if (session.improvement_score !== null && session.improvement_score !== undefined) {
        acc[date].scores.push(session.improvement_score);
      }
      acc[date].time += session.time_spent || 0;
      return acc;
    }, {} as Record<string, { scores: number[]; time: number }>);

    return Object.entries(grouped).map(([date, data]) => ({
      date,
      score: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : null,
      time: data.time,
    })).filter(d => d.score !== null);
  };

  // Calculate subject-wise performance
  const getSubjectPerformance = () => {
    const subjectData = sessions.reduce((acc, session) => {
      const subject = session.subject || session.topic || "General Study";
      // Skip "General Study" for cleaner subject performance view
      if (subject === "General Study") return acc;
      
      if (!acc[subject]) {
        acc[subject] = { sessions: 0, totalScore: 0, totalTime: 0, scoreCount: 0 };
      }
      acc[subject].sessions++;
      // Only add to score if we have a real score
      if (session.improvement_score !== null && session.improvement_score !== undefined) {
        acc[subject].totalScore += session.improvement_score;
        acc[subject].scoreCount++;
      }
      acc[subject].totalTime += session.time_spent || 0;
      return acc;
    }, {} as Record<string, { sessions: number; totalScore: number; totalTime: number; scoreCount: number }>);

    return Object.entries(subjectData)
      .map(([subject, data]) => ({
        subject: subject.length > 12 ? subject.slice(0, 12) + "..." : subject,
        avgScore: data.scoreCount > 0 ? Math.round(data.totalScore / data.scoreCount) : 0,
        totalTime: data.totalTime,
        sessions: data.sessions,
      }))
      .filter(s => s.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 6);
  };

  // Calculate study patterns (time of day, day of week)
  const getStudyPatterns = () => {
    const dayData: Record<string, number> = {
      Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0
    };
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    sessions.forEach(session => {
      const date = new Date(session.created_at);
      const day = days[date.getDay()];
      dayData[day] += session.time_spent || 0;
    });

    return Object.entries(dayData).map(([day, minutes]) => ({
      day,
      minutes,
      hours: Math.round(minutes / 60 * 10) / 10,
    }));
  };

  // Calculate understanding level distribution
  const getUnderstandingDistribution = () => {
    const distribution: Record<string, number> = {
      excellent: 0,
      good: 0,
      average: 0,
      weak: 0,
    };

    sessions.forEach(session => {
      const level = session.understanding_level || "average";
      if (distribution[level] !== undefined) {
        distribution[level]++;
      }
    });

    return Object.entries(distribution)
      .filter(([_, count]) => count > 0)
      .map(([level, count]) => ({
        name: level.charAt(0).toUpperCase() + level.slice(1),
        value: count,
      }));
  };

  // Get weak and strong areas
  const getAreasAnalysis = () => {
    const weakAreas: Record<string, number> = {};
    const strongAreas: Record<string, number> = {};

    sessions.forEach(session => {
      (session.weak_areas || []).forEach(area => {
        weakAreas[area] = (weakAreas[area] || 0) + 1;
      });
      (session.strong_areas || []).forEach(area => {
        strongAreas[area] = (strongAreas[area] || 0) + 1;
      });
    });

    return {
      weak: Object.entries(weakAreas).sort((a, b) => b[1] - a[1]).slice(0, 5),
      strong: Object.entries(strongAreas).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  };

  // Calculate overall stats
  const getOverallStats = () => {
    const totalSessions = sessions.length;
    const totalMinutes = sessions.reduce((acc, s) => acc + (s.time_spent || 0), 0);
    
    // Only calculate avg from sessions with actual scores
    const sessionsWithScores = sessions.filter(s => s.improvement_score !== null && s.improvement_score !== undefined);
    const avgScore = sessionsWithScores.length > 0
      ? Math.round(sessionsWithScores.reduce((acc, s) => acc + (s.improvement_score || 0), 0) / sessionsWithScores.length)
      : 0;
    
    // Calculate consistency (unique days studied in last 30 days)
    const last30Days = sessions.filter(s => {
      const date = new Date(s.created_at);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return date >= thirtyDaysAgo;
    });
    const daysStudied = new Set(last30Days.map(s => new Date(s.created_at).toDateString())).size;
    const consistency = Math.round((daysStudied / 30) * 100);

    // Calculate current streak
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const hasSession = sessions.some(s => 
        new Date(s.created_at).toDateString() === checkDate.toDateString()
      );
      if (hasSession) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }

    // Quiz stats
    const totalQuizzes = quizzes.length;
    const avgQuizAccuracy = totalQuizzes > 0
      ? Math.round(quizzes.reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) / totalQuizzes)
      : 0;

    return { totalSessions, totalMinutes, avgScore, consistency, streak, totalQuizzes, avgQuizAccuracy };
  };

  // Skill radar data
  const getSkillRadarData = () => {
    const stats = getOverallStats();
    return [
      { skill: "Consistency", value: stats.consistency, fullMark: 100 },
      { skill: "Quiz Accuracy", value: stats.avgQuizAccuracy, fullMark: 100 },
      { skill: "Engagement", value: Math.min(100, (stats.totalMinutes / 60) * 2), fullMark: 100 },
      { skill: "Improvement", value: stats.avgScore, fullMark: 100 },
      { skill: "Sessions", value: Math.min(100, stats.totalSessions * 5), fullMark: 100 },
    ];
  };

  // Weekly comparison data
  const getWeeklyComparison = () => {
    const weeks: { week: string; sessions: number; time: number; score: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      
      const weekSessions = sessions.filter(s => {
        const date = new Date(s.created_at);
        return date >= weekStart && date < weekEnd;
      });

      weeks.push({
        week: `Week ${4 - i}`,
        sessions: weekSessions.length,
        time: Math.round(weekSessions.reduce((acc, s) => acc + (s.time_spent || 0), 0) / 60),
        score: weekSessions.length > 0
          ? Math.round(weekSessions.reduce((acc, s) => acc + (s.improvement_score || 50), 0) / weekSessions.length)
          : 0,
      });
    }
    return weeks;
  };

  // Calculate grade
  const calculateGrade = () => {
    const stats = getOverallStats();
    const score = (stats.avgScore * 0.4) + (stats.avgQuizAccuracy * 0.3) + (stats.consistency * 0.3);
    if (score >= 85) return { grade: "A+", color: "#22c55e", label: "Excellent" };
    if (score >= 75) return { grade: "A", color: "#22c55e", label: "Very Good" };
    if (score >= 65) return { grade: "B+", color: "#3b82f6", label: "Good" };
    if (score >= 55) return { grade: "B", color: "#3b82f6", label: "Above Average" };
    if (score >= 45) return { grade: "C", color: "#f59e0b", label: "Average" };
    return { grade: "D", color: "#ef4444", label: "Needs Improvement" };
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yPos = 15;
      const margin = 15;
      const stats = getOverallStats();
      const gradeInfo = calculateGrade();

      // Header
      pdf.setFillColor(59, 130, 246);
      pdf.rect(0, 0, pageWidth, 30, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Study Buddy AI - Progress Report", margin, 15);
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date().toLocaleDateString("en-IN")}`, margin, 24);

      yPos = 40;
      pdf.setTextColor(0, 0, 0);

      // Student Info
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(studentName, margin, yPos);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Class: ${studentClass} | Grade: ${gradeInfo.grade} (${gradeInfo.label})`, margin, yPos + 7);
      yPos += 20;

      // Stats
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("Overall Statistics", margin, yPos);
      yPos += 8;
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      
      const statsText = [
        `Total Sessions: ${stats.totalSessions}`,
        `Total Study Time: ${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`,
        `Average Score: ${stats.avgScore}%`,
        `Consistency: ${stats.consistency}%`,
        `Current Streak: ${stats.streak} days`,
        `Quiz Accuracy: ${stats.avgQuizAccuracy}%`,
      ];
      statsText.forEach(text => {
        pdf.text(`• ${text}`, margin + 5, yPos);
        yPos += 6;
      });

      // Footer
      pdf.setFillColor(59, 130, 246);
      pdf.rect(0, pageHeight - 12, pageWidth, 12, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(8);
      pdf.text("Study Buddy AI - Your Personal Study Buddy", pageWidth / 2, pageHeight - 5, { align: "center" });

      pdf.save(`${studentName.replace(/\s+/g, "_")}_Progress_${new Date().toISOString().split("T")[0]}.pdf`);
      
      toast({
        title: "PDF Downloaded!",
        description: "Your progress report has been saved.",
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        title: t("progress.downloadFailedTitle"),
        description: t("progress.downloadFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading || isLoading) {
    return <ProgressSkeleton />;
  }

  const improvementData = getImprovementData();
  const subjectData = getSubjectPerformance();
  const patternData = getStudyPatterns();
  const understandingData = getUnderstandingDistribution();
  const areasAnalysis = getAreasAnalysis();
  const stats = getOverallStats();
  const skillRadarData = getSkillRadarData();
  const weeklyData = getWeeklyComparison();
  const gradeInfo = calculateGrade();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Professional Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="hover:bg-primary/10">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="font-bold text-xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">{t("progress.title")}</h1>
                  <p className="text-sm text-muted-foreground">{studentName} • Class {studentClass}</p>
                </div>
              </div>
            </div>
              <div className="flex items-center gap-4">
                <LanguageToggle />
                {/* Grade Badge */}
                <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-muted/50 to-muted/30 border border-border/50">
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-md"
                    style={{ backgroundColor: gradeInfo.color }}
                  >
                    {gradeInfo.grade}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("progress.overallGrade")}</p>
                    <p className="font-semibold text-sm">{gradeInfo.label}</p>
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary shadow-md"
                >
                  {downloadingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      {t("progress.downloadPdf")}
                    </>
                  )}
                </Button>
              </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Mobile Grade Badge */}
        <div className="sm:hidden mb-6 flex justify-center">
          <div className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-card border border-border shadow-sm">
            <div 
              className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg"
              style={{ backgroundColor: gradeInfo.color }}
            >
              {gradeInfo.grade}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("progress.overallGrade")}</p>
              <p className="font-bold text-lg">{gradeInfo.label}</p>
            </div>
          </div>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label={t("progress.totalSessions")}
            value={stats.totalSessions.toString()}
            color="primary"
          />
          <StatCard
            icon={<Clock className="w-5 h-5" />}
            label={t("progress.studyTime")}
            value={`${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`}
            color="accent"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label={t("progress.avgScore")}
            value={`${stats.avgScore}%`}
            color="primary"
          />
          <StatCard
            icon={<Target className="w-5 h-5" />}
            label={t("progress.consistency")}
            value={`${stats.consistency}%`}
            color="accent"
          />
          <StatCard
            icon={<Flame className="w-5 h-5" />}
            label={t("progress.streak")}
            value={`${stats.streak} days`}
            color="primary"
            highlight={stats.streak >= 3}
          />
          <StatCard
            icon={<Award className="w-5 h-5" />}
            label={t("progress.quizzes")}
            value={stats.totalQuizzes.toString()}
            color="accent"
          />
          <StatCard
            icon={<Zap className="w-5 h-5" />}
            label={t("progress.quizAccuracy")}
            value={`${stats.avgQuizAccuracy}%`}
            color="primary"
          />
        </div>

        {/* Charts Grid - Row 1 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Improvement Over Time */}
          <div className="edu-card p-6 lg:col-span-2">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              {t("progress.improvementOverTime")}
            </h3>
            {improvementData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={improvementData}>
                  <defs>
                    <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#scoreGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>{t("progress.startStudyingEmpty")}</p>
                  </div>
                </div>
            )}
          </div>

          {/* Skill Radar */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-primary" />
              {t("progress.skillAssessment")}
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={skillRadarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
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

        {/* Charts Grid - Row 2 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Subject Performance */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              {t("progress.subjectPerformance")}
            </h3>
            {subjectData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={subjectData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0, 100]} />
                  <YAxis dataKey="subject" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} width={80} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))", 
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px"
                    }} 
                  />
                  <Bar dataKey="avgScore" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} name="Avg Score" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                {t("progress.noDataYet")}
              </div>
            )}
          </div>

          {/* Weekly Comparison */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              {t("progress.weeklyComparison")}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px"
                  }} 
                />
                <Legend />
                <Bar yAxisId="left" dataKey="sessions" fill="hsl(var(--primary))" name="Sessions" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="score" stroke="hsl(var(--accent))" strokeWidth={2} name="Avg Score" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Study Patterns */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              {t("progress.weeklyStudyPattern")}
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={patternData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--card))", 
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px"
                  }}
                  formatter={(value: number) => [`${value} min`, 'Study Time']}
                />
                <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Charts Grid - Row 3 */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Understanding Distribution */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              {t("progress.understandingLevels")}
            </h3>
            {understandingData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie
                      data={understandingData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      fill="hsl(var(--primary))"
                      dataKey="value"
                      labelLine={false}
                    >
                      {understandingData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))", 
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px"
                      }} 
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {understandingData.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-sm">{item.name}</span>
                      </div>
                      <span className="font-semibold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground">
                {t("progress.noDataYet")}
              </div>
            )}
          </div>

          {/* Quiz Performance */}
          {quizzes.length > 0 && (
            <div className="edu-card p-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-primary" />
                {t("progress.recentQuizPerformance")}
              </h3>
              <div className="space-y-3">
                {quizzes.slice(0, 5).map((quiz) => {
                  const percentage = quiz.accuracy_percentage || 0;
                  return (
                    <div key={quiz.id} className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">
                          {new Date(quiz.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {quiz.correct_count}/{quiz.total_questions} {t("progress.correctLabel")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${
                              percentage >= 70 ? "bg-accent" : percentage >= 50 ? "bg-yellow-500" : "bg-destructive"
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className={`font-bold text-sm ${
                          percentage >= 70 ? "text-accent" : percentage >= 50 ? "text-yellow-500" : "text-destructive"
                        }`}>
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Areas Analysis */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Strong Areas */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 text-accent flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              {t("progress.strongAreas")}
            </h3>
            {areasAnalysis.strong.length > 0 ? (
              <div className="space-y-3">
                {areasAnalysis.strong.map(([area, count], index) => (
                  <div key={area} className="flex items-center justify-between p-3 bg-accent/10 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-sm">
                        {index + 1}
                      </div>
                      <span className="font-medium">{area}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{count} sessions</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                {t("progress.keepStudyingStrengths")}
              </p>
            )}
          </div>

          {/* Weak Areas */}
          <div className="edu-card p-6">
            <h3 className="font-bold text-lg mb-4 text-destructive flex items-center gap-2">
              <Target className="w-5 h-5" />
              {t("progress.areasToImprove")}
            </h3>
            {areasAnalysis.weak.length > 0 ? (
              <div className="space-y-3">
                {areasAnalysis.weak.map(([area, count], index) => (
                  <div key={area} className="flex items-center justify-between p-3 bg-destructive/10 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center text-destructive font-bold text-sm">
                        {index + 1}
                      </div>
                      <span className="font-medium">{area}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{count} sessions</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                {t("progress.noWeakAreasYet")}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

const StatCard = ({
  icon,
  label,
  value,
  color,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "primary" | "accent";
  highlight?: boolean;
}) => {
  const colorClasses = {
    primary: "bg-gradient-to-br from-primary/15 to-primary/5 text-primary",
    accent: "bg-gradient-to-br from-accent/15 to-accent/5 text-accent",
  };

  return (
    <div className={`edu-card p-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg ${highlight ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}>
      <div className={`w-10 h-10 rounded-xl ${colorClasses[color]} flex items-center justify-center mb-3 shadow-sm`}>
        {icon}
      </div>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold mt-1 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">{value}</p>
    </div>
  );
};

export default StudentProgress;