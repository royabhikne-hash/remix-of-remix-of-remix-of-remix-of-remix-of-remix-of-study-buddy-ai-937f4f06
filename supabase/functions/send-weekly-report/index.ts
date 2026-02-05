import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
}

interface DetailedReport {
  studentId: string;
  studentName: string;
  studentClass: string;
  schoolName: string;
  parentWhatsapp: string;
  totalSessions: number;
  totalMinutes: number;
  totalQuizzes: number;
  avgAccuracy: number;
  avgScore: number;
  studyConsistency: number;
  daysStudied: number;
  sessions: SessionData[];
  quizzes: QuizData[];
  topicsCovered: { topic: string; sessions: number; avgScore: number }[];
  weakAreas: string[];
  strongAreas: string[];
  subjectsStudied: string[];
  dailyBreakdown: { day: string; date: string; sessions: number; timeSpent: number; quizzes: number }[];
  grade: string;
  gradeLabel: string;
  trend: "improving" | "declining" | "stable";
  currentStreak: number;
  recommendations: string[];
  parentTips: string[];
}

const calculateGrade = (avgScore: number, avgAccuracy: number, sessionCount: number): { grade: string; label: string } => {
  const score = (avgScore * 0.4) + (avgAccuracy * 0.3) + (sessionCount * 5 * 0.3);
  if (score >= 85) return { grade: "A+", label: "Excellent" };
  if (score >= 75) return { grade: "A", label: "Very Good" };
  if (score >= 65) return { grade: "B+", label: "Good" };
  if (score >= 55) return { grade: "B", label: "Above Average" };
  if (score >= 45) return { grade: "C", label: "Average" };
  return { grade: "D", label: "Needs Improvement" };
};

const generateDetailedWhatsAppMessage = (report: DetailedReport): string => {
  const dateRange = `${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('hi-IN')} - ${new Date().toLocaleDateString('hi-IN')}`;
  
  const trendEmoji = report.trend === "improving" ? "📈" : report.trend === "declining" ? "📉" : "➡️";
  const trendText = report.trend === "improving" ? "IMPROVING" : report.trend === "declining" ? "DECLINING" : "STABLE";
  
  let message = `🎓 *${report.studentName} - Detailed Weekly Report*
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏫 ${report.schoolName}
📚 ${report.studentClass}
📅 ${dateRange}

═══════════════════════════
        🏆 OVERALL GRADE: ${report.grade}
              ${report.gradeLabel}
        ${trendEmoji} Trend: ${trendText}
═══════════════════════════

📊 *WEEKLY SUMMARY*
┌─────────────────────────
│ 📚 Total Sessions: ${report.totalSessions}
│ ⏱️ Study Time: ${Math.floor(report.totalMinutes / 60)}h ${report.totalMinutes % 60}m
│ 📝 Quizzes Taken: ${report.totalQuizzes}
│ ✅ Quiz Accuracy: ${report.avgAccuracy}%
│ 📈 Avg Score: ${report.avgScore}%
│ 🔥 Study Streak: ${report.currentStreak} days
│ 📅 Days Studied: ${report.daysStudied}/7
│ 💯 Consistency: ${report.studyConsistency}%
└─────────────────────────`;

  // Daily Breakdown
  if (report.dailyBreakdown.length > 0) {
    message += `\n\n📅 *DAILY BREAKDOWN*\n┌─────────────────────────`;
    
    report.dailyBreakdown.forEach(day => {
      const status = day.sessions > 0 ? "✅" : "❌";
      message += `\n│ ${status} ${day.day} (${day.date}): ${day.sessions} sessions, ${day.timeSpent}min`;
    });
    
    message += `\n└─────────────────────────`;
  }

  // Subjects Studied
  if (report.subjectsStudied.length > 0) {
    message += `\n\n📖 *SUBJECTS STUDIED*\n${report.subjectsStudied.map(s => `  ✓ ${s}`).join('\n')}`;
  }

  // Topics with Performance
  if (report.topicsCovered.length > 0) {
    message += `\n\n📝 *TOPICS COVERED*`;
    report.topicsCovered.slice(0, 8).forEach(t => {
      const scoreEmoji = t.avgScore >= 70 ? "🌟" : t.avgScore >= 50 ? "👍" : "📚";
      message += `\n  ${scoreEmoji} ${t.topic}: ${t.sessions}x, ${t.avgScore}%`;
    });
  }

  // Strong Areas
  if (report.strongAreas.length > 0) {
    message += `\n\n✅ *STRONG AREAS*\n${report.strongAreas.slice(0, 5).map(s => `  🌟 ${s}`).join('\n')}`;
  }

  // Weak Areas
  if (report.weakAreas.length > 0) {
    message += `\n\n⚠️ *NEEDS IMPROVEMENT*\n${report.weakAreas.slice(0, 5).map(s => `  📚 ${s}`).join('\n')}`;
  }

  // Quiz Performance Details
  if (report.totalQuizzes > 0) {
    const passedQuizzes = report.quizzes.filter(q => (q.accuracy_percentage || 0) >= 50).length;
    const totalCorrect = report.quizzes.reduce((acc, q) => acc + q.correct_count, 0);
    const totalQuestions = report.quizzes.reduce((acc, q) => acc + q.total_questions, 0);
    
    message += `\n\n🧠 *QUIZ PERFORMANCE*
┌─────────────────────────
│ 📝 Total Quizzes: ${report.totalQuizzes}
│ ✅ Passed: ${passedQuizzes}/${report.totalQuizzes}
│ ❓ Answered: ${totalCorrect}/${totalQuestions}
│ 📊 Pass Rate: ${Math.round((passedQuizzes / report.totalQuizzes) * 100)}%
└─────────────────────────`;
  }

  // Recent Sessions Summary
  if (report.sessions.length > 0) {
    message += `\n\n📋 *RECENT SESSIONS*`;
    report.sessions.slice(0, 5).forEach(s => {
      const date = new Date(s.created_at);
      const dayName = date.toLocaleDateString('hi-IN', { weekday: 'short' });
      const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const levelEmoji = s.understanding_level === 'excellent' ? '🌟' : s.understanding_level === 'good' ? '✅' : s.understanding_level === 'average' ? '📈' : '📚';
      
      message += `\n  ${levelEmoji} ${dayName} ${dateStr}: ${s.topic || s.subject || 'General'} (${s.time_spent || 0}min)`;
    });
  }

  // AI Recommendations
  if (report.recommendations.length > 0) {
    message += `\n\n💡 *AI RECOMMENDATIONS*\n${report.recommendations.map(r => `  ${r}`).join('\n')}`;
  }

  // Parent Tips
  message += `\n\n👨‍👩‍👧 *PARENT TIPS*\n${report.parentTips.map(t => `  ${t}`).join('\n')}`;

  // Footer
  message += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 *Study Buddy AI*
🌐 Daily progress track karein!

_${new Date().toLocaleString('hi-IN')}_`;

  return message;
};

const sendWhatsAppMessage = async (to: string, message: string): Promise<boolean> => {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_WHATSAPP_FROM");

  if (!accountSid || !authToken || !fromNumber) {
    console.error("Twilio credentials not configured");
    return false;
  }

  let formattedTo = to.replace(/\D/g, '');
  if (!formattedTo.startsWith('91')) {
    formattedTo = '91' + formattedTo;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: `whatsapp:${fromNumber}`,
        To: `whatsapp:+${formattedTo}`,
        Body: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Twilio error:", response.status, errorText);
      return false;
    }

    console.log(`WhatsApp sent successfully to ${formattedTo}`);
    return true;
  } catch (error) {
    console.error("Error sending WhatsApp:", error);
    return false;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let body: { studentId?: string; testMode?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // No body provided
    }

    console.log("Starting detailed report generation...", body.testMode ? "(Test Mode)" : "");

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    let studentsQuery = supabase.from("students").select("*, schools(name, district, state)");
    if (body.studentId && body.testMode) {
      studentsQuery = studentsQuery.eq("id", body.studentId);
    }

    const { data: students, error: studentsError } = await studentsQuery;

    if (studentsError) {
      console.error("Error fetching students:", studentsError);
      throw studentsError;
    }

    console.log(`Found ${students?.length || 0} students`);

    const reports: { studentName: string; sent: boolean; reportData?: DetailedReport }[] = [];

    for (const student of students || []) {
      const { data: sessions } = await supabase
        .from("study_sessions")
        .select("*")
        .eq("student_id", student.id)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false });

      const { data: quizzes } = await supabase
        .from("quiz_attempts")
        .select("*")
        .eq("student_id", student.id)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false });

      const sessionList: SessionData[] = (sessions || []) as SessionData[];
      const quizList: QuizData[] = (quizzes || []) as QuizData[];
      
      const totalSessions = sessionList.length;
      const totalMinutes = sessionList.reduce((acc, s) => acc + (s.time_spent || 0), 0);
      const totalQuizzes = quizList.length;
      const avgAccuracy = totalQuizzes > 0 
        ? Math.round(quizList.reduce((acc, q) => acc + (q.accuracy_percentage || 0), 0) / totalQuizzes)
        : 0;
      const avgScore = totalSessions > 0 
        ? Math.round(sessionList.reduce((acc, s) => acc + (s.improvement_score || 50), 0) / totalSessions)
        : 0;
      
      const studyDates = new Set(sessionList.map(s => new Date(s.created_at).toDateString()));
      const daysStudied = studyDates.size;
      const studyConsistency = Math.round((daysStudied / 7) * 100);
      
      const topicData: Record<string, { sessions: number; totalScore: number }> = {};
      sessionList.forEach(s => {
        const topic = s.topic || "General Study";
        if (!topicData[topic]) {
          topicData[topic] = { sessions: 0, totalScore: 0 };
        }
        topicData[topic].sessions++;
        topicData[topic].totalScore += s.improvement_score || 50;
      });
      
      const topicsCovered = Object.entries(topicData)
        .map(([topic, data]) => ({
          topic,
          sessions: data.sessions,
          avgScore: Math.round(data.totalScore / data.sessions),
        }))
        .sort((a, b) => b.sessions - a.sessions);
      
      const weakAreas = [...new Set(sessionList.flatMap(s => s.weak_areas || []))];
      const strongAreas = [...new Set(sessionList.flatMap(s => s.strong_areas || []))];
      const subjectsStudied = [...new Set(sessionList.map(s => s.subject).filter(Boolean))] as string[];
      
      const dailyBreakdown: { day: string; date: string; sessions: number; timeSpent: number; quizzes: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayStr = date.toLocaleDateString("hi-IN", { weekday: "short" });
        const dateStr = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        
        const daySessions = sessionList.filter(s => new Date(s.created_at).toDateString() === date.toDateString());
        const dayQuizzes = quizList.filter(q => new Date(q.created_at).toDateString() === date.toDateString());
        
        dailyBreakdown.push({
          day: dayStr,
          date: dateStr,
          sessions: daySessions.length,
          timeSpent: daySessions.reduce((acc, s) => acc + (s.time_spent || 0), 0),
          quizzes: dayQuizzes.length,
        });
      }
      
      let currentStreak = 0;
      for (let i = 0; i <= 6; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const hasSession = sessionList.some(s => new Date(s.created_at).toDateString() === date.toDateString());
        if (hasSession) {
          currentStreak++;
        } else if (i === 0) {
          currentStreak = 0;
          break;
        } else {
          break;
        }
      }
      
      let trend: "improving" | "declining" | "stable" = "stable";
      if (sessionList.length >= 2) {
        const mid = Math.floor(sessionList.length / 2);
        const recentAvg = sessionList.slice(0, mid).reduce((acc, s) => acc + (s.improvement_score || 50), 0) / mid;
        const olderAvg = sessionList.slice(mid).reduce((acc, s) => acc + (s.improvement_score || 50), 0) / (sessionList.length - mid);
        if (recentAvg > olderAvg + 5) trend = "improving";
        else if (recentAvg < olderAvg - 5) trend = "declining";
      }
      
      const gradeInfo = calculateGrade(avgScore, avgAccuracy, totalSessions);
      
      const recommendations: string[] = [];
      if (currentStreak === 0) {
        recommendations.push("🎯 आज से पढ़ाई शुरू करें!");
      } else if (currentStreak >= 3) {
        recommendations.push("🏆 शानदार streak! जारी रखें!");
      }
      
      if (avgAccuracy < 50 && totalQuizzes > 0) {
        recommendations.push("📖 Quiz के लिए topics दोबारा पढ़ें।");
      } else if (avgAccuracy >= 70) {
        recommendations.push("⭐ Quiz performance excellent!");
      }
      
      if (weakAreas.length > 0) {
        recommendations.push(`⚠️ Focus: ${weakAreas.slice(0, 2).join(", ")}`);
      }
      
      if (totalMinutes < 60) {
        recommendations.push("⏰ Daily 30+ min study करें।");
      }
      
      const parentTips = [
        "👨‍👩‍👧 रोज़ 10 min बच्चे से बात करें",
        "🌟 छोटी उपलब्धियों की तारीफ़ करें",
        "📱 Screen time balance करें",
        "🏠 शांत जगह दें पढ़ाई के लिए",
      ];
      
      const schoolInfo = student.schools as { name: string; district: string | null; state: string | null } | null;
      
      const report: DetailedReport = {
        studentId: student.id,
        studentName: student.full_name,
        studentClass: student.class,
        schoolName: schoolInfo?.name || "N/A",
        parentWhatsapp: student.parent_whatsapp,
        totalSessions,
        totalMinutes,
        totalQuizzes,
        avgAccuracy,
        avgScore,
        studyConsistency,
        daysStudied,
        sessions: sessionList,
        quizzes: quizList,
        topicsCovered,
        weakAreas,
        strongAreas,
        subjectsStudied,
        dailyBreakdown,
        grade: gradeInfo.grade,
        gradeLabel: gradeInfo.label,
        trend,
        currentStreak,
        recommendations,
        parentTips,
      };

      const messageContent = generateDetailedWhatsAppMessage(report);
      const sent = await sendWhatsAppMessage(student.parent_whatsapp, messageContent);
      
      reports.push({ studentName: student.full_name, sent, reportData: report });
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log("Detailed weekly reports completed:", reports.map(r => ({ name: r.studentName, sent: r.sent })));

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${reports.length} students`,
        reports,
        reportData: reports[0]?.reportData || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Weekly report error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});