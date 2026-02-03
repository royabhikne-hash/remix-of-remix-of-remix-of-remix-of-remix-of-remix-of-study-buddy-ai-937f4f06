import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  BookOpen,
  Clock,
  TrendingUp,
  LogOut,
  Play,
  CheckCircle,
  XCircle,
  User,
  BarChart3,
  MessageCircle,
  Loader2,
  History,
  CalendarDays,
  Sun,
  Trophy,
} from "lucide-react";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";
import ChatHistory from "@/components/ChatHistory";
import StudentRankingCard from "@/components/StudentRankingCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";

interface RecentSession {
  id: string;
  topic: string;
  date: string;
  duration: number;
  score: number;
}

const StudentDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, signOut, loading } = useAuth();
  const { t, language } = useLanguage();
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [userName, setUserName] = useState("Student");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [parentWhatsapp, setParentWhatsapp] = useState<string | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string>("");
  const [studentDistrict, setStudentDistrict] = useState<string>("");
  
  const [analyticsView, setAnalyticsView] = useState<"today" | "week">("today");
  const [mainTab, setMainTab] = useState<"study" | "rankings">("study");
  const [isDataLoading, setIsDataLoading] = useState(true);
  
  // Ranking data
  const [mySchoolRank, setMySchoolRank] = useState<any>(null);
  const [myDistrictRank, setMyDistrictRank] = useState<any>(null);
  const [totalSchoolStudents, setTotalSchoolStudents] = useState(0);
  const [totalDistrictStudents, setTotalDistrictStudents] = useState(0);
  const [rankingHistory, setRankingHistory] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  
  const [todayStats, setTodayStats] = useState({
    sessions: 0,
    minutes: 0,
    avgScore: 0,
    studied: false,
  });
  
  const [weekStats, setWeekStats] = useState({
    sessions: 0,
    minutes: 0,
    avgScore: 0,
    daysStudied: 0,
  });

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
      return;
    }

    if (user) {
      loadStudentData();
    }
  }, [user, loading, navigate]);

  // Real-time subscription for approval status changes
  useEffect(() => {
    if (!studentId) return;

    const channel = supabase
      .channel('student-approval')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'students',
          filter: `id=eq.${studentId}`,
        },
        (payload) => {
          console.log('Student data updated:', payload);
          if (payload.new && 'is_approved' in payload.new) {
            setIsApproved(payload.new.is_approved as boolean);
            if (payload.new.is_approved) {
              loadStudentData(); // Reload full data when approved
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId]);

  const loadStudentData = async () => {
    if (!user) return;

    try {
      // Get student profile with school info
      const { data: student } = await supabase
        .from("students")
        .select("*, schools(name)")
        .eq("user_id", user.id)
        .maybeSingle();

      setIsDataLoading(true);
      
      if (student) {
        setUserName(student.full_name);
        setStudentId(student.id);
        setParentWhatsapp(student.parent_whatsapp);
        setIsApproved(student.is_approved);
        setRejectionReason(student.rejection_reason || null);
        setSchoolName((student.schools as any)?.name || "Your School");
        setStudentDistrict(student.district || "Your District");
        
        // Load ranking data if approved
        if (student.is_approved) {
          loadRankingData(student.id);
        }
        
        // Only load sessions if approved
        if (student.is_approved) {
          // Fetch sessions with quiz attempts to get actual scores
          const { data: sessions } = await supabase
            .from("study_sessions")
            .select("*, quiz_attempts(accuracy_percentage)")
            .eq("student_id", student.id)
            .not("time_spent", "eq", 0)  // Only get sessions that were actually completed
            .order("created_at", { ascending: false });

          if (sessions) {
            const today = new Date();
            const todayStr = today.toDateString();
            
            // Get the start of this week (Sunday = 0)
            const currentDay = today.getDay();
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - currentDay);
            weekStart.setHours(0, 0, 0, 0);
            
            // Filter today's sessions
            const todaySessions = sessions.filter(s => new Date(s.created_at).toDateString() === todayStr);
            
            // Filter this week's sessions (since last Sunday)
            const weekSessions = sessions.filter(s => new Date(s.created_at) >= weekStart);
            
            // Calculate scores helper
            const getAvgScore = (sessionList: typeof sessions) => {
              const scores = sessionList.map(s => {
                const quizAttempts = s.quiz_attempts as { accuracy_percentage: number | null }[] | null;
                if (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null) {
                  return quizAttempts[0].accuracy_percentage;
                }
                return s.improvement_score || 50;
              });
              return scores.length > 0 
                ? Math.round(scores.reduce((acc, s) => acc + s, 0) / scores.length)
                : 0;
            };
            
            // Today stats (refresh every 24 hours)
            setTodayStats({
              sessions: todaySessions.length,
              minutes: todaySessions.reduce((acc, s) => acc + (s.time_spent || 0), 0),
              avgScore: getAvgScore(todaySessions),
              studied: todaySessions.length > 0,
            });
            
            // Week stats (refresh every Sunday)
            const uniqueDays = new Set(weekSessions.map(s => new Date(s.created_at).toDateString())).size;
            setWeekStats({
              sessions: weekSessions.length,
              minutes: weekSessions.reduce((acc, s) => acc + (s.time_spent || 0), 0),
              avgScore: getAvgScore(weekSessions),
              daysStudied: uniqueDays,
            });

            // Recent sessions
            const recent = sessions.slice(0, 5).map((s) => {
              const quizAttempts = s.quiz_attempts as { accuracy_percentage: number | null }[] | null;
              const score = (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null)
                ? quizAttempts[0].accuracy_percentage
                : s.improvement_score || 0;
              const displayTopic = s.subject || s.topic || "General Study";
              
              return {
                id: s.id,
                topic: displayTopic,
                date: formatDate(new Date(s.created_at)),
                duration: s.time_spent || 0,
                score: Math.round(score),
              };
            });
            setRecentSessions(recent);
          }
        }
        setIsDataLoading(false);
      } else {
        setUserName(user.user_metadata?.full_name || user.email?.split("@")[0] || "Student");
        setIsApproved(null);
        setIsDataLoading(false);
      }
    } catch (error) {
      console.error("Error loading student data:", error);
    }
  };

  const loadRankingData = async (studentIdToLoad: string) => {
    try {
      // Fetch rankings
      const { data, error } = await supabase.functions.invoke("get-students", {
        body: {
          action: "get_student_rankings",
          student_id: studentIdToLoad,
        },
      });

      if (error) {
        console.error("Error fetching rankings:", error);
        return;
      }

      if (data) {
        setMySchoolRank(data.mySchoolRank);
        setMyDistrictRank(data.myDistrictRank);
        setTotalSchoolStudents(data.totalSchoolStudents || 0);
        setTotalDistrictStudents(data.totalDistrictStudents || 0);
        setRankingHistory(data.rankingHistory || []);
      }

      // Fetch achievements
      const { data: achievementsData } = await supabase
        .from("achievements")
        .select("*")
        .eq("student_id", studentIdToLoad)
        .order("achieved_at", { ascending: false })
        .limit(20);
      
      if (achievementsData) {
        setAchievements(achievementsData);
      }

      // Fetch notifications
      const { data: notificationsData } = await supabase
        .from("rank_notifications")
        .select("*")
        .eq("student_id", studentIdToLoad)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (notificationsData) {
        setNotifications(notificationsData);
      }
    } catch (err) {
      console.error("Error loading ranking data:", err);
    }
  };

  const handleMarkNotificationRead = async (notificationId: string) => {
    try {
      await supabase
        .from("rank_notifications")
        .update({ is_read: true })
        .eq("id", notificationId);
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const formatDate = (date: Date): string => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString();
  };

  const handleStartStudy = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    // Prevent default and stop propagation for touch events to avoid double-firing
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (isApproved === false) {
      toast({
        title: "Approval Pending",
        description: "Aapka account abhi approve nahi hua. Please wait!",
        variant: "destructive",
      });
      return;
    }
    
    console.log("Navigating to study page via internal router...");
    
    // Use router navigation for WebView/PWA compatibility
    // This avoids window.open, popups, or external redirects
    // Works in: Desktop, Mobile Browser, PWA, WebView, APK
    try {
      navigate("/study");
    } catch (err) {
      console.error("Router navigation error, using SPA history fallback:", err);
      // Fallback: keep it INTERNAL (no full reload) for WebView/PWA/APK
      try {
        window.history.pushState({}, "", "/study");
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (fallbackErr) {
        console.error("History fallback failed:", fallbackErr);
      }
    }
  }, [isApproved, toast, navigate]);

  // handleEndStudy is now in StudyPage.tsx - study sessions are handled via route navigation

  const handleSendReport = async () => {
    if (!studentId || !parentWhatsapp) {
      toast({
        title: "Cannot send report",
        description: "Student profile or parent WhatsApp not found.",
        variant: "destructive"
      });
      return;
    }

    setSendingReport(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-weekly-report', {
        body: { studentId, testMode: true }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Report Sent! 📱",
          description: `WhatsApp report sent to parent successfully.`,
        });
      } else {
        throw new Error(data?.error || "Failed to send report");
      }
    } catch (err) {
      console.error("Error sending report:", err);
      toast({
        title: "Failed to send report",
        description: err instanceof Error ? err.message : "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setSendingReport(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  if (loading || isDataLoading) {
    return <DashboardSkeleton />;
  }

  // Show pending approval or rejection screen
  if (isApproved === false) {
    const isRejected = rejectionReason !== null;
    
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="edu-card p-8 max-w-md text-center">
          <div className={`w-20 h-20 rounded-full ${isRejected ? 'bg-destructive/20' : 'bg-warning/20'} flex items-center justify-center mx-auto mb-6`}>
            {isRejected ? (
              <XCircle className="w-10 h-10 text-destructive" />
            ) : (
              <Clock className="w-10 h-10 text-warning" />
            )}
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {isRejected ? "Registration Rejected" : "Approval Pending"}
          </h1>
          <p className="text-muted-foreground mb-4">
            Namaste {userName}! 👋
          </p>
          
          {isRejected ? (
            <>
              <p className="text-muted-foreground mb-4">
                Aapki registration <strong>{schoolName}</strong> ne reject kar di hai.
              </p>
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 mb-6">
                <p className="text-sm font-medium text-destructive mb-1">Rejection Reason:</p>
                <p className="text-sm text-foreground">{rejectionReason}</p>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Agar aapko lagta hai ye galti se hua hai, toh school se contact karo.
              </p>
            </>
          ) : (
            <>
              <p className="text-muted-foreground mb-6">
                Aapka account abhi <strong>{schoolName}</strong> se approve hona baaki hai. 
                Jab school aapko approve kar dega, tab aap study kar paoge.
              </p>
              <div className="bg-secondary/50 rounded-xl p-4 mb-6">
                <p className="text-sm text-muted-foreground">
                  🔔 School ko inform kar diya gaya hai. Thoda wait karo!
                </p>
              </div>
            </>
          )}
          
          <Button variant="outline" onClick={handleLogout} className="w-full">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    );
  }

  if (showChatHistory && studentId) {
    return <ChatHistory studentId={studentId} onClose={() => setShowChatHistory(false)} />;
  }

  // Study sessions now use route navigation (/study) for WebView/PWA compatibility

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <img 
                src="/logo.png" 
                alt="Study Buddy AI" 
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex-shrink-0 object-contain"
              />
              <div className="min-w-0">
                <span className="font-bold text-sm sm:text-lg truncate block">{t('app.name')}</span>
                <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">{t('nav.dashboard')}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-3">
              <LanguageToggle />
              <ThemeToggle />
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => navigate("/profile")}
                className="sm:hidden"
              >
                <User className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate("/profile")}
                className="hidden sm:flex items-center gap-2"
              >
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <span className="font-medium">{userName}</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - ChatGPT-style wider layout */}
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-6xl">
        {/* Welcome & Start Study */}
        <div className="mb-6 sm:mb-8">
          <div className="edu-card p-4 sm:p-6 md:p-8 text-center bg-gradient-to-br from-primary/10 to-accent/10">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2">
              {language === 'en' ? `Hello, ${userName}!` : `Namaste, ${userName}!`} 👋
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6">
              {todayStats.studied
                ? (language === 'en' ? "Great job studying today! Ready for more?" : "Aaj padhai achi ki! Aur karna hai?")
                : (language === 'en' ? "What do you want to study today? Let's start!" : "Aaj kya padhna hai? Chal start karte hain!")}
            </p>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
              <Button 
                variant="hero" 
                size="lg" 
                className="text-sm sm:text-base touch-manipulation"
                onClick={handleStartStudy}
                onTouchStart={handleStartStudy}
              >
                <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                {language === 'en' ? 'Start Studying' : 'Padhai Shuru Karo'}
              </Button>
              <Button variant="outline" size="default" className="text-xs sm:text-sm" onClick={() => setShowChatHistory(true)}>
                <History className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Chat History
              </Button>
              <Button variant="outline" size="default" className="text-xs sm:text-sm" onClick={() => navigate("/progress")}>
                <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                {t('nav.progress')}
              </Button>
              <Button 
                variant="secondary" 
                size="default"
                className="text-xs sm:text-sm"
                onClick={handleSendReport} 
                disabled={sendingReport}
              >
                {sendingReport ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 animate-spin" /> : <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />}
                {t('action.sendReport')}
              </Button>
            </div>
          </div>
        </div>

        {/* Main Tabs: Study / Rankings */}
        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "study" | "rankings")} className="mb-6">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
            <TabsTrigger value="study" className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Study
            </TabsTrigger>
            <TabsTrigger value="rankings" className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              Rankings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="study" className="mt-6">
            {/* Analytics Toggle */}
            <div className="flex justify-center mb-6">
              <Tabs value={analyticsView} onValueChange={(v) => setAnalyticsView(v as "today" | "week")} className="w-auto">
                <TabsList className="grid grid-cols-2 w-64">
                  <TabsTrigger value="today" className="flex items-center gap-2">
                    <Sun className="w-4 h-4" />
                    Today
                  </TabsTrigger>
                  <TabsTrigger value="week" className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4" />
                    This Week
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Stats Grid - Today View */}
            {analyticsView === "today" && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                  icon={<CheckCircle className="w-5 h-5" />}
                  label="Today Status"
                  value={todayStats.studied ? "Studied ✓" : "Not Yet"}
                  color={todayStats.studied ? "accent" : "muted"}
                />
                <StatCard
                  icon={<BookOpen className="w-5 h-5" />}
                  label="Today Sessions"
                  value={todayStats.sessions.toString()}
                  color="primary"
                />
                <StatCard
                  icon={<Clock className="w-5 h-5" />}
                  label="Today's Time"
                  value={`${Math.floor(todayStats.minutes / 60)}h ${todayStats.minutes % 60}m`}
                  color="primary"
                />
                <StatCard
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="Today Score"
                  value={todayStats.avgScore > 0 ? `${todayStats.avgScore}%` : "-"}
                  color="accent"
                />
              </div>
            )}

            {/* Stats Grid - Week View */}
            {analyticsView === "week" && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                  icon={<CalendarDays className="w-5 h-5" />}
                  label="Days Studied"
                  value={`${weekStats.daysStudied}/7`}
                  color={weekStats.daysStudied >= 5 ? "accent" : "primary"}
                />
                <StatCard
                  icon={<BookOpen className="w-5 h-5" />}
                  label="Week Sessions"
                  value={weekStats.sessions.toString()}
                  color="primary"
                />
                <StatCard
                  icon={<Clock className="w-5 h-5" />}
                  label="Week Time"
                  value={`${Math.floor(weekStats.minutes / 60)}h ${weekStats.minutes % 60}m`}
                  color="primary"
                />
                <StatCard
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="Week Avg Score"
                  value={weekStats.avgScore > 0 ? `${weekStats.avgScore}%` : "-"}
                  color="accent"
                />
              </div>
            )}

            {/* Recent Sessions */}
            <div className="edu-card p-6">
              <h2 className="text-lg font-bold mb-4">Recent Study Sessions</h2>
              {recentSessions.length > 0 ? (
                <div className="space-y-3">
                  {recentSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-4 bg-secondary/30 rounded-xl"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold">{session.topic}</p>
                          <p className="text-sm text-muted-foreground">{session.date}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{session.duration} min</p>
                        <p className="text-sm text-accent font-medium">Score: {session.score}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No study sessions yet. Start your first session!</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="rankings" className="mt-6">
            <StudentRankingCard
              mySchoolRank={mySchoolRank}
              myDistrictRank={myDistrictRank}
              totalSchoolStudents={totalSchoolStudents}
              totalDistrictStudents={totalDistrictStudents}
              schoolName={schoolName}
              district={studentDistrict}
              rankingHistory={rankingHistory}
              achievements={achievements}
              notifications={notifications}
              onMarkNotificationRead={handleMarkNotificationRead}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "primary" | "accent" | "muted";
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ icon, label, value, color }, ref) => {
    const colorClasses = {
      primary: "bg-primary/10 text-primary",
      accent: "bg-accent/10 text-accent",
      muted: "bg-muted text-muted-foreground",
    };

    return (
      <div ref={ref} className="edu-card p-4">
        <div className={`w-10 h-10 rounded-lg ${colorClasses[color]} flex items-center justify-center mb-3`}>
          {icon}
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
    );
  }
);

StatCard.displayName = "StatCard";

export default StudentDashboard;
