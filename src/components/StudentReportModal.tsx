import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
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
  Legend,
} from "recharts";
import {
  X,
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
} from "lucide-react";

interface StudentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  studentPhoto?: string;
  studentClass: string;
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

const StudentReportModal = ({
  isOpen,
  onClose,
  studentId,
  studentName,
  studentPhoto,
  studentClass,
}: StudentReportModalProps) => {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [quizzes, setQuizzes] = useState<QuizData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (isOpen && studentId) {
      loadStudentData();
    }
  }, [isOpen, studentId]);

  const loadStudentData = async () => {
    setLoading(true);
    try {
      // Load study sessions from last 7 days
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: sessionsData } = await supabase
        .from("study_sessions")
        .select("*")
        .eq("student_id", studentId)
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false });

      const { data: quizzesData } = await supabase
        .from("quiz_attempts")
        .select("*")
        .eq("student_id", studentId)
        .gte("created_at", weekAgo.toISOString())
        .order("created_at", { ascending: false });

      setSessions(sessionsData || []);
      setQuizzes(quizzesData || []);
    } catch (error) {
      console.error("Error loading student data:", error);
    } finally {
      setLoading(false);
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

  const progressData = getProgressChartData();
  const subjectData = getSubjectChartData();
  const understandingChartData = getUnderstandingChartData();

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      let yPos = 20;
      const lineHeight = 7;
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;

      // Helper function to add new page if needed
      const checkPageBreak = (requiredSpace: number) => {
        if (yPos + requiredSpace > pdf.internal.pageSize.getHeight() - 20) {
          pdf.addPage();
          yPos = 20;
        }
      };

      // Title
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text("Student Progress Report", pageWidth / 2, yPos, { align: "center" });
      yPos += 10;

      // Subtitle
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text("Edu Improvement AI", pageWidth / 2, yPos, { align: "center" });
      yPos += 15;

      // Student Info
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(studentName, margin, yPos);
      yPos += lineHeight;
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Class: ${studentClass}`, margin, yPos);
      yPos += lineHeight;
      pdf.text(`Report Date: ${new Date().toLocaleDateString("en-IN")}`, margin, yPos);
      yPos += lineHeight;
      pdf.text(`Period: Last 7 Days`, margin, yPos);
      yPos += 12;

      // Overall Trend
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      const trendText = overallTrend === "up" ? "📈 Improving" : overallTrend === "down" ? "📉 Declining" : "➡️ Stable";
      pdf.text(`Overall Trend: ${trendText}`, margin, yPos);
      yPos += 12;

      // Weekly Summary
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("Weekly Summary", margin, yPos);
      yPos += lineHeight;
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`• Study Sessions: ${weeklyStats.totalSessions}`, margin + 5, yPos);
      yPos += lineHeight;
      pdf.text(`• Time Spent: ${Math.round(weeklyStats.totalTimeSpent / 60)} minutes`, margin + 5, yPos);
      yPos += lineHeight;
      pdf.text(`• Quizzes Taken: ${weeklyStats.totalQuizzes}`, margin + 5, yPos);
      yPos += lineHeight;
      pdf.text(`• Average Accuracy: ${weeklyStats.avgAccuracy}%`, margin + 5, yPos);
      yPos += 12;

      // Subjects Studied
      if (subjectsStudied.length > 0) {
        checkPageBreak(20);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Subjects Studied", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(`• ${subjectsStudied.join(", ")}`, margin + 5, yPos);
        yPos += 12;
      }

      // Understanding Levels
      if (Object.keys(understandingDist).length > 0) {
        checkPageBreak(30);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Understanding Levels", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        Object.entries(understandingDist).forEach(([level, count]) => {
          pdf.text(`• ${level.charAt(0).toUpperCase() + level.slice(1)}: ${count} sessions`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Weak Areas
      if (topWeakAreas.length > 0) {
        checkPageBreak(30);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Areas Needing Improvement", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        topWeakAreas.forEach(([area, count]) => {
          pdf.text(`• ${area} (mentioned ${count}x)`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Strong Areas
      if (topStrongAreas.length > 0) {
        checkPageBreak(30);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Strong Areas", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        topStrongAreas.forEach(([area, count]) => {
          pdf.text(`• ${area} (mentioned ${count}x)`, margin + 5, yPos);
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // Recent Quiz Results
      if (quizzes.length > 0) {
        checkPageBreak(40);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("Recent Quiz Results", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        quizzes.slice(0, 5).forEach((quiz) => {
          checkPageBreak(lineHeight);
          const date = new Date(quiz.created_at).toLocaleDateString("en-IN");
          pdf.text(
            `• ${date}: Score ${quiz.correct_count}/${quiz.total_questions} (${quiz.accuracy_percentage?.toFixed(0) || 0}%)`,
            margin + 5,
            yPos
          );
          yPos += lineHeight;
        });
        yPos += 5;
      }

      // AI Feedback
      if (aiSummaries.length > 0) {
        checkPageBreak(40);
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("AI Feedback Summary", margin, yPos);
        yPos += lineHeight;
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        aiSummaries.forEach((summary) => {
          checkPageBreak(20);
          const lines = pdf.splitTextToSize(`"${summary}"`, contentWidth - 10);
          lines.forEach((line: string) => {
            pdf.text(line, margin + 5, yPos);
            yPos += 5;
          });
          yPos += 5;
        });
      }

      // Footer
      checkPageBreak(20);
      yPos = pdf.internal.pageSize.getHeight() - 15;
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "italic");
      pdf.text("Generated by Edu Improvement AI", pageWidth / 2, yPos, { align: "center" });

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
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-secondary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {studentPhoto ? (
                <img
                  src={studentPhoto}
                  alt={studentName}
                  className="w-16 h-16 rounded-full object-cover border-2 border-primary"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold text-primary-foreground">
                  {studentName.charAt(0)}
                </div>
              )}
              <div>
                <DialogTitle className="text-xl">{studentName}</DialogTitle>
                <p className="text-muted-foreground">{studentClass}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {overallTrend === "up" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent/20 text-accent text-sm font-medium">
                  <TrendingUp className="w-4 h-4" /> Improving
                </span>
              )}
              {overallTrend === "down" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-destructive/20 text-destructive text-sm font-medium">
                  <TrendingDown className="w-4 h-4" /> Declining
                </span>
              )}
              {overallTrend === "stable" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm font-medium">
                  <Minus className="w-4 h-4" /> Stable
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || loading}
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Weekly Summary Stats */}
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Weekly Summary (Last 7 Days)
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="edu-card p-4 text-center">
                    <p className="text-3xl font-bold text-primary">{weeklyStats.totalSessions}</p>
                    <p className="text-sm text-muted-foreground">Study Sessions</p>
                  </div>
                  <div className="edu-card p-4 text-center">
                    <p className="text-3xl font-bold text-accent">
                      {Math.round(weeklyStats.totalTimeSpent / 60)}m
                    </p>
                    <p className="text-sm text-muted-foreground">Time Spent</p>
                  </div>
                  <div className="edu-card p-4 text-center">
                    <p className="text-3xl font-bold text-primary">{weeklyStats.totalQuizzes}</p>
                    <p className="text-sm text-muted-foreground">Quizzes Taken</p>
                  </div>
                  <div className="edu-card p-4 text-center">
                    <p className="text-3xl font-bold text-accent">{weeklyStats.avgAccuracy}%</p>
                    <p className="text-sm text-muted-foreground">Avg Accuracy</p>
                  </div>
                </div>
              </div>

              {/* Performance Charts Section */}
              {sessions.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-primary" />
                    Performance Analytics
                  </h3>
                  
                  {/* Progress Over Time Chart */}
                  <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div className="edu-card p-4">
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">Progress Over Time (7 Days)</h4>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={progressData}>
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
                          <Line
                            type="monotone"
                            dataKey="score"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ fill: "hsl(var(--primary))", strokeWidth: 2 }}
                            name="Avg Score"
                          />
                          <Line
                            type="monotone"
                            dataKey="time"
                            stroke="hsl(var(--accent))"
                            strokeWidth={2}
                            dot={{ fill: "hsl(var(--accent))", strokeWidth: 2 }}
                            name="Time (min)"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Understanding Distribution Pie Chart */}
                    {understandingChartData.length > 0 && (
                      <div className="edu-card p-4">
                        <h4 className="text-sm font-medium mb-3 text-muted-foreground">Understanding Distribution</h4>
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
                  </div>

                  {/* Subject Performance Bar Chart */}
                  {subjectData.length > 0 && (
                    <div className="edu-card p-4 mb-6">
                      <h4 className="text-sm font-medium mb-3 text-muted-foreground">Subject Performance</h4>
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
                          <Bar dataKey="sessions" fill="hsl(var(--primary))" name="Sessions" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="avgScore" fill="hsl(var(--accent))" name="Avg Score" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
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
                          <span className="text-sm">{area}</span>
                          <span className="text-xs text-muted-foreground">{count}x mentioned</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {topStrongAreas.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Target className="w-5 h-5 text-accent" />
                      Strong Areas
                    </h3>
                    <div className="space-y-2">
                      {topStrongAreas.map(([area, count], i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 bg-accent/10 rounded-lg"
                        >
                          <span className="text-sm">{area}</span>
                          <span className="text-xs text-muted-foreground">{count}x mentioned</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Feedback */}
              {aiSummaries.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <MessageCircle className="w-5 h-5 text-primary" />
                    AI Feedback Summary
                  </h3>
                  <div className="space-y-3">
                    {aiSummaries.map((summary, i) => (
                      <div key={i} className="p-4 bg-secondary/50 rounded-lg">
                        <p className="text-sm text-foreground">{summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Quiz Results */}
              {quizzes.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Recent Quiz Results
                  </h3>
                  <div className="space-y-2">
                    {quizzes.slice(0, 5).map((quiz) => (
                      <div
                        key={quiz.id}
                        className="flex items-center justify-between p-3 edu-card"
                      >
                        <div>
                          <p className="font-medium">
                            Score: {quiz.correct_count}/{quiz.total_questions}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(quiz.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-lg font-bold ${
                              (quiz.accuracy_percentage || 0) >= 70
                                ? "text-accent"
                                : (quiz.accuracy_percentage || 0) >= 50
                                ? "text-primary"
                                : "text-destructive"
                            }`}
                          >
                            {quiz.accuracy_percentage?.toFixed(0) || 0}%
                          </span>
                          {quiz.understanding_result && (
                            <p className="text-xs text-muted-foreground capitalize">
                              {quiz.understanding_result}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Study Sessions */}
              {sessions.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-primary" />
                    Recent Study Sessions
                  </h3>
                  <div className="space-y-2">
                    {sessions.slice(0, 5).map((session) => (
                      <div key={session.id} className="p-3 edu-card">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium">{session.topic}</p>
                          <span
                            className={`text-xs px-2 py-1 rounded-full capitalize ${getUnderstandingColor(
                              session.understanding_level || "average"
                            )}`}
                          >
                            {session.understanding_level || "average"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {session.subject && `${session.subject} • `}
                          {formatDate(session.created_at)}
                          {session.time_spent && ` • ${Math.round(session.time_spent / 60)}m`}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sessions.length === 0 && quizzes.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No study activity in the last 7 days.</p>
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
