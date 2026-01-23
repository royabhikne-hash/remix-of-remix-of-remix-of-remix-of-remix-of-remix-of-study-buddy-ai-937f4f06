import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  LogOut,
  Search,
  BookOpen,
  CheckCircle,
  XCircle,
  Eye,
  UserCheck,
  UserX,
  Clock,
  Loader2,
  AlertTriangle,
  Trash2,
  CheckSquare,
  Square,
  MapPin,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import StudentReportModal from "@/components/StudentReportModal";
import { useToast } from "@/hooks/use-toast";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDebounce } from "@/hooks/useDebounce";
import StudentRanking from "@/components/StudentRanking";

interface RankingData {
  id: string;
  name: string;
  photo?: string;
  class: string;
  district?: string;
  schoolName?: string;
  improvementScore: number;
  dailyStudyTime: number;
  weeklyStudyDays: number;
  totalScore: number;
  rank: number;
}

interface StudentData {
  id: string;
  photo: string;
  name: string;
  class: string;
  todayStudied: boolean;
  topicStudied: string;
  improvementTrend: "up" | "down" | "stable";
  totalSessions: number;
  isApproved: boolean;
  createdAt: string;
}

const SchoolDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [schoolName, setSchoolName] = useState("School");
  const [schoolUuid, setSchoolUuid] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClass, setSelectedClass] = useState("all");
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<StudentData | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("approved");
  const [rankingsTab, setRankingsTab] = useState<"school" | "district">("school");
  const [rankings, setRankings] = useState<RankingData[]>([]);
  const [districtRankings, setDistrictRankings] = useState<RankingData[]>([]);
  const [schoolDistrict, setSchoolDistrict] = useState<string>("");
  
  // Fee payment check
  const [feePaid, setFeePaid] = useState(true);
  
  // Rejection dialog state
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingStudent, setRejectingStudent] = useState<StudentData | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Delete confirmation dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    student: StudentData | null;
  }>({ open: false, student: null });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection state
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showBulkRejectDialog, setShowBulkRejectDialog] = useState(false);
  const [bulkRejectionReason, setBulkRejectionReason] = useState("");

  useEffect(() => {
    const storedSchoolName = localStorage.getItem("schoolName");
    const storedSchoolId = localStorage.getItem("schoolId");
    
    if (!storedSchoolId) {
      navigate("/school-login");
      return;
    }
    
    if (storedSchoolName) {
      setSchoolName(storedSchoolName);
    }

    checkSchoolAccess();
  }, [navigate]);

  const checkSchoolAccess = async () => {
    try {
      const storedSchoolId = localStorage.getItem("schoolId");
      
      if (!storedSchoolId) {
        setLoading(false);
        return;
      }

      // Check if school is banned or fee not paid (via backend function)
      const { data, error } = await supabase.functions.invoke("get-schools-public", {
        body: { action: "by_school_id", school_id: storedSchoolId },
      });

      if (error || data?.error) {
        console.error("School access check error:", error || data?.error);
        setLoading(false);
        return;
      }

      const school = data?.school as { id: string; is_banned: boolean | null; fee_paid: boolean | null } | null;

      if (!school) {
        setLoading(false);
        return;
      }

      if (school.is_banned) {
        toast({
          title: "Access Denied",
          description: "Your school has been banned. Please contact admin.",
          variant: "destructive",
        });
        localStorage.clear();
        navigate("/school-login");
        return;
      }

      if (!school.fee_paid) {
        setFeePaid(false);
        setLoading(false);
        return;
      }

      setSchoolUuid(school.id);
      loadStudents(school.id);
    } catch (error) {
      console.error("Error checking school access:", error);
      setLoading(false);
    }
  };

  const loadStudents = async (schoolId?: string) => {
    try {
      const id = schoolId || schoolUuid;
      
      if (!id) {
        setLoading(false);
        return;
      }

      // Use edge function to bypass RLS and get students for this school
      const sessionToken = localStorage.getItem("schoolSessionToken");
      const { data, error } = await supabase.functions.invoke("get-students", {
        body: {
          user_type: "school",
          session_token: sessionToken,
          school_id: id,
        },
      });

      if (error) {
        console.error("Error fetching students:", error);
        setLoading(false);
        return;
      }

      if (data?.students) {
        const today = new Date().toDateString();
        
        const formattedStudents: StudentData[] = data.students.map((student: any) => {
          const studentSessions = student.study_sessions || [];
          const todaySessions = studentSessions.filter((s: any) => 
            new Date(s.created_at).toDateString() === today
          );
          const latestSession = todaySessions[0];

          // Calculate trend based on recent scores
          const recentScores = studentSessions.slice(0, 5).map((s: any) => s.improvement_score || 50);
          let trend: "up" | "down" | "stable" = "stable";
          if (recentScores.length >= 2) {
            const avg1 = recentScores.slice(0, 2).reduce((a: number, b: number) => a + b, 0) / 2;
            const avg2 = recentScores.slice(-2).reduce((a: number, b: number) => a + b, 0) / 2;
            if (avg1 > avg2 + 5) trend = "up";
            else if (avg1 < avg2 - 5) trend = "down";
          }

          return {
            id: student.id,
            photo: student.photo_url || "",
            name: student.full_name,
            class: student.class,
            todayStudied: todaySessions.length > 0,
            topicStudied: latestSession?.topic || "-",
            improvementTrend: trend,
            totalSessions: studentSessions.length,
            isApproved: student.is_approved,
            createdAt: student.created_at,
          };
        });

        setStudents(formattedStudents);
        
        // Set rankings from backend
        if (data?.rankings) {
          setRankings(data.rankings);
        }
        if (data?.districtRankings) {
          setDistrictRankings(data.districtRankings);
        }
        if (data?.schoolDistrict) {
          setSchoolDistrict(data.schoolDistrict);
        }
      }
    } catch (error) {
      console.error("Error loading students:", error);
    } finally {
      setLoading(false);
    }
  };

  const getSchoolCredentials = () => {
    const schoolId = localStorage.getItem("schoolId");
    const schoolUUID = localStorage.getItem("schoolUUID") || schoolUuid;
    const sessionToken = localStorage.getItem("schoolSessionToken");
    
    if (!schoolId || !schoolUUID || !sessionToken) {
      return null;
    }
    
    return { schoolId, schoolUUID, sessionToken };
  };

  const handleApproveStudent = async (studentId: string) => {
    setApprovingId(studentId);

    try {
      const creds = getSchoolCredentials();
      if (!creds) {
        toast({
          title: "Session expired",
          description: "Please login again to approve students.",
          variant: "destructive",
        });
        localStorage.clear();
        navigate("/school-login");
        return;
      }

      const { data, error } = await supabase.functions.invoke("school-student-approval", {
        body: {
          action: "approve",
          schoolId: creds.schoolId,
          schoolUuid: creds.schoolUUID,
          sessionToken: creds.sessionToken,
          studentId,
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Approval failed");
      }

      setStudents((prev) =>
        prev.map((s) => (s.id === studentId ? { ...s, isApproved: true } : s))
      );

      toast({
        title: "Student Approved ✓",
        description: "Student can now use the study platform.",
      });
    } catch (error) {
      console.error("Error approving student:", error);
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Could not approve student. Please try again.",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  const openRejectDialog = (student: StudentData) => {
    setRejectingStudent(student);
    setRejectionReason("");
    setShowRejectDialog(true);
  };

  const handleRejectStudent = async () => {
    if (!rejectingStudent) return;

    setApprovingId(rejectingStudent.id);
    try {
      const creds = getSchoolCredentials();
      if (!creds) {
        toast({
          title: "Session expired",
          description: "Please login again to reject students.",
          variant: "destructive",
        });
        localStorage.clear();
        navigate("/school-login");
        return;
      }

      const { data, error } = await supabase.functions.invoke("school-student-approval", {
        body: {
          action: "reject",
          schoolId: creds.schoolId,
          schoolUuid: creds.schoolUUID,
          sessionToken: creds.sessionToken,
          studentId: rejectingStudent.id,
          rejectionReason: rejectionReason.trim() || "No reason provided",
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Rejection failed");
      }

      // Remove from local state
      setStudents((prev) => prev.filter((s) => s.id !== rejectingStudent.id));

      toast({
        title: "Student Rejected",
        description: "Student request has been rejected with reason.",
      });

      setShowRejectDialog(false);
      setRejectingStudent(null);
      setRejectionReason("");
    } catch (error) {
      console.error("Error rejecting student:", error);
      toast({
        title: "Rejection Failed",
        description: error instanceof Error ? error.message : "Could not reject student. Please try again.",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  // Bulk actions
  const togglePendingSelection = (studentId: string) => {
    setSelectedPendingIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const selectAllPending = () => {
    const pendingIds = pendingStudents.map((s) => s.id);
    setSelectedPendingIds(new Set(pendingIds));
  };

  const deselectAllPending = () => {
    setSelectedPendingIds(new Set());
  };

  const handleBulkApprove = async () => {
    if (selectedPendingIds.size === 0) return;

    setBulkProcessing(true);
    try {
      const creds = getSchoolCredentials();
      if (!creds) {
        toast({
          title: "Session expired",
          description: "Please login again.",
          variant: "destructive",
        });
        localStorage.clear();
        navigate("/school-login");
        return;
      }

      const { data, error } = await supabase.functions.invoke("school-student-approval", {
        body: {
          action: "bulk_approve",
          schoolId: creds.schoolId,
          schoolUuid: creds.schoolUUID,
          sessionToken: creds.sessionToken,
          studentIds: Array.from(selectedPendingIds),
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Bulk approval failed");
      }

      setStudents((prev) =>
        prev.map((s) => (selectedPendingIds.has(s.id) ? { ...s, isApproved: true } : s))
      );

      toast({
        title: `${data.count} Students Approved ✓`,
        description: "Students can now use the study platform.",
      });

      setSelectedPendingIds(new Set());
    } catch (error) {
      console.error("Error bulk approving:", error);
      toast({
        title: "Bulk Approval Failed",
        description: error instanceof Error ? error.message : "Could not approve students.",
        variant: "destructive",
      });
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedPendingIds.size === 0) return;

    setBulkProcessing(true);
    try {
      const creds = getSchoolCredentials();
      if (!creds) {
        toast({
          title: "Session expired",
          description: "Please login again.",
          variant: "destructive",
        });
        localStorage.clear();
        navigate("/school-login");
        return;
      }

      const { data, error } = await supabase.functions.invoke("school-student-approval", {
        body: {
          action: "bulk_reject",
          schoolId: creds.schoolId,
          schoolUuid: creds.schoolUUID,
          sessionToken: creds.sessionToken,
          studentIds: Array.from(selectedPendingIds),
          rejectionReason: bulkRejectionReason.trim() || "No reason provided",
        },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Bulk rejection failed");
      }

      setStudents((prev) => prev.filter((s) => !selectedPendingIds.has(s.id)));

      toast({
        title: `${data.count} Students Rejected`,
        description: "Student requests have been rejected.",
      });

      setSelectedPendingIds(new Set());
      setShowBulkRejectDialog(false);
      setBulkRejectionReason("");
    } catch (error) {
      console.error("Error bulk rejecting:", error);
      toast({
        title: "Bulk Rejection Failed",
        description: error instanceof Error ? error.message : "Could not reject students.",
        variant: "destructive",
      });
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    navigate("/");
  };

  const handleDeleteStudent = async (studentId: string) => {
    setDeletingId(studentId);
    try {
      const { error } = await supabase
        .from("students")
        .delete()
        .eq("id", studentId);

      if (error) throw error;

      setStudents((prev) => prev.filter((s) => s.id !== studentId));
      toast({
        title: "Student Removed",
        description: "Student has been removed from your school.",
      });
    } catch (error) {
      console.error("Error deleting student:", error);
      toast({
        title: "Error",
        description: "Failed to remove student. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
      setDeleteDialog({ open: false, student: null });
    }
  };

  const handleViewReport = (student: StudentData) => {
    setSelectedStudent(student);
    setShowReportModal(true);
  };

  // Debounce search for performance
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Memoized filtered lists
  const pendingStudents = useMemo(() => students.filter(s => !s.isApproved), [students]);
  const approvedStudents = useMemo(() => students.filter(s => s.isApproved), [students]);

  const filteredStudents = useMemo(() => {
    return approvedStudents.filter((student) => {
      const matchesSearch = student.name.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchesClass = selectedClass === "all" || student.class === selectedClass;
      return matchesSearch && matchesClass;
    });
  }, [approvedStudents, debouncedSearch, selectedClass]);

  const uniqueClasses = useMemo(() => [...new Set(approvedStudents.map((s) => s.class))], [approvedStudents]);

  const stats = useMemo(() => ({
    totalStudents: approvedStudents.length,
    pendingApprovals: pendingStudents.length,
    studiedToday: approvedStudents.filter((s) => s.todayStudied).length,
    improving: approvedStudents.filter((s) => s.improvementTrend === "up").length,
  }), [approvedStudents, pendingStudents]);

  const getTrendLabel = (trend: "up" | "down" | "stable") => {
    switch (trend) {
      case "up":
        return <span className="text-accent font-medium">Improving ↑</span>;
      case "down":
        return <span className="text-destructive font-medium">Declining ↓</span>;
      default:
        return <span className="text-muted-foreground font-medium">Stable →</span>;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Building2 className="w-6 h-6 text-accent-foreground" />
          </div>
          <p className="text-muted-foreground">{t("school.dashboardLoading")}</p>
        </div>
      </div>
    );
  }

  // Fee not paid screen
  if (!feePaid) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="edu-card p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-4">{t("school.accessSuspendedTitle")}</h1>
          <p className="text-muted-foreground mb-6">
            {t("school.accessSuspendedDesc")}
          </p>
          <div className="space-y-3">
            <Button variant="outline" className="w-full" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              {t("nav.logout")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4 sm:w-6 sm:h-6 text-accent-foreground" />
              </div>
              <div className="min-w-0">
                <span className="font-bold text-sm sm:text-lg truncate block">{schoolName}</span>
                <p className="text-xs text-muted-foreground hidden sm:block">{t("school.dashboardTitle")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-4 sm:py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-6 sm:mb-8">
          <div className="edu-card p-3 sm:p-4 text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.totalStudents}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("student.approved")}</p>
          </div>
          <div className="edu-card p-3 sm:p-4 text-center relative">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-warning/10 flex items-center justify-center mx-auto mb-2">
              <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-warning" />
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.pendingApprovals}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("student.pending")}</p>
            {stats.pendingApprovals > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 sm:w-3 sm:h-3 bg-warning rounded-full animate-pulse" />
            )}
          </div>
          <div className="edu-card p-3 sm:p-4 text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
              <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-accent" />
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.studiedToday}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("school.today")}</p>
          </div>
          <div className="edu-card p-3 sm:p-4 text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <p className="text-xl sm:text-2xl font-bold">{stats.improving}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">{t("school.improving")}</p>
          </div>
        </div>

        {/* Tabs for Pending vs Approved vs Rankings */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="approved" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <UserCheck className="w-3 h-3 sm:w-4 sm:h-4" />
              {t("student.approved")} ({approvedStudents.length})
            </TabsTrigger>
            <TabsTrigger value="pending" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm relative">
              <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
              {t("student.pending")} ({pendingStudents.length})
              {pendingStudents.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-warning rounded-full" />
              )}
            </TabsTrigger>
            <TabsTrigger value="rankings" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
              Rankings
            </TabsTrigger>
          </TabsList>

          {/* Pending Approvals Tab */}
          <TabsContent value="pending" className="mt-4 sm:mt-6">
            <div className="edu-card overflow-hidden">
              <div className="p-3 sm:p-4 border-b border-border bg-warning/10">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="font-bold flex items-center gap-2 text-sm sm:text-base">
                      <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-warning" />
                      {t("school.pendingApprovalsTitle")}
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                      {t("school.pendingApprovalsDesc")}
                    </p>
                  </div>
                  
                  {/* Bulk Actions */}
                  {pendingStudents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedPendingIds.size > 0 && (
                        <span className="text-xs sm:text-sm text-muted-foreground">
                          {selectedPendingIds.size} {t("school.selectedCount")}
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={selectedPendingIds.size === pendingStudents.length ? deselectAllPending : selectAllPending}
                        className="text-xs"
                      >
                        {selectedPendingIds.size === pendingStudents.length ? (
                          <>
                            <Square className="w-3 h-3 mr-1" />
                            {t("school.deselect")}
                          </>
                        ) : (
                          <>
                            <CheckSquare className="w-3 h-3 mr-1" />
                            {t("school.selectAll")}
                          </>
                        )}
                      </Button>
                      {selectedPendingIds.size > 0 && (
                        <>
                          <Button
                            size="sm"
                            onClick={handleBulkApprove}
                            disabled={bulkProcessing}
                            className="bg-accent hover:bg-accent/90 text-xs"
                          >
                            {bulkProcessing ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="w-3 h-3 mr-1" />
                                {t("school.approveAll")}
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowBulkRejectDialog(true)}
                            disabled={bulkProcessing}
                            className="text-destructive hover:text-destructive text-xs"
                          >
                            <UserX className="w-3 h-3 mr-1" />
                            {t("school.rejectAll")}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              {pendingStudents.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <UserCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t("school.noPendingTitle")}</p>
                  <p className="text-sm">{t("school.noPendingDesc")}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {pendingStudents.map((student) => (
                    <div key={student.id} className="p-3 sm:p-4 hover:bg-muted/30">
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <div className="pt-2">
                          <Checkbox
                            checked={selectedPendingIds.has(student.id)}
                            onCheckedChange={() => togglePendingSelection(student.id)}
                          />
                        </div>
                        
                        {/* Student Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-3">
                            {student.photo ? (
                              <img 
                                src={student.photo} 
                                alt={student.name}
                                className="w-10 h-10 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-warning/30 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-secondary flex items-center justify-center text-base sm:text-xl font-bold border-2 border-warning/30 flex-shrink-0">
                                {student.name.charAt(0)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm sm:text-lg truncate">{student.name}</p>
                              <p className="text-xs sm:text-sm text-muted-foreground">Class: {student.class}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {formatDate(student.createdAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRejectDialog(student)}
                            disabled={approvingId === student.id}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                          >
                            {approvingId === student.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <UserX className="w-3 h-3 sm:mr-1" />
                                <span className="hidden sm:inline">Reject</span>
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleApproveStudent(student.id)}
                            disabled={approvingId === student.id}
                            className="bg-accent hover:bg-accent/90 text-xs"
                          >
                            {approvingId === student.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="w-3 h-3 sm:mr-1" />
                                <span className="hidden sm:inline">Approve</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Approved Students Tab */}
          <TabsContent value="approved" className="mt-4 sm:mt-6">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                <Input
                  placeholder={t("school.searchStudents")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 sm:pl-10 h-10 sm:h-12"
                />
              </div>
              <select
                className="flex h-10 sm:h-12 rounded-xl border border-input bg-background px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              >
                <option value="all">{t("school.allClasses")}</option>
                {uniqueClasses.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>

            {/* Student List */}
            <div className="edu-card overflow-hidden">
              <div className="p-3 sm:p-4 border-b border-border bg-secondary/30">
                <h2 className="font-bold text-sm sm:text-base">{t("school.studentActivity")}</h2>
              </div>
              
              {approvedStudents.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{t("school.noApprovedTitle")}</p>
                  <p className="text-sm">{t("school.noApprovedDesc")}</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-4 font-semibold">{t("school.table.student")}</th>
                          <th className="text-left p-4 font-semibold">{t("student.class")}</th>
                          <th className="text-left p-4 font-semibold">{t("school.table.today")}</th>
                          <th className="text-left p-4 font-semibold">{t("school.table.topicStudied")}</th>
                          <th className="text-left p-4 font-semibold">{t("school.table.trend")}</th>
                          <th className="text-left p-4 font-semibold">{t("school.table.sessions")}</th>
                          <th className="text-left p-4 font-semibold">{t("school.table.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudents.map((student) => (
                          <tr key={student.id} className="border-t border-border hover:bg-muted/30">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                {student.photo ? (
                                  <img 
                                    src={student.photo} 
                                    alt={student.name}
                                    className="w-10 h-10 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg font-bold">
                                    {student.name.charAt(0)}
                                  </div>
                                )}
                                <span className="font-medium">{student.name}</span>
                              </div>
                            </td>
                            <td className="p-4 text-muted-foreground">{student.class}</td>
                            <td className="p-4">
                              {student.todayStudied ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-sm">
                                  <CheckCircle className="w-4 h-4" /> {t("school.yes")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground text-sm">
                                  <XCircle className="w-4 h-4" /> {t("school.no")}
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-muted-foreground">{student.topicStudied}</td>
                            <td className="p-4">{getTrendLabel(student.improvementTrend)}</td>
                            <td className="p-4 font-medium">{student.totalSessions}</td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewReport(student)}
                                  className="text-primary hover:text-primary/80"
                                >
                                  <Eye className="w-4 h-4 mr-1" />
                                  {t("action.view")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteDialog({ open: true, student })}
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={deletingId === student.id}
                                >
                                  {deletingId === student.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden divide-y divide-border">
                    {filteredStudents.map((student) => (
                      <div key={student.id} className="p-3 sm:p-4">
                        <div className="flex items-start justify-between mb-2 sm:mb-3">
                          <div className="flex items-center gap-2 sm:gap-3">
                            {student.photo ? (
                              <img 
                                src={student.photo} 
                                alt={student.name}
                                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-secondary flex items-center justify-center text-base sm:text-lg font-bold">
                                {student.name.charAt(0)}
                              </div>
                            )}
                            <div>
                              <p className="font-semibold text-sm sm:text-base">{student.name}</p>
                              <p className="text-xs sm:text-sm text-muted-foreground">{student.class}</p>
                            </div>
                          </div>
                          {student.todayStudied ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs">
                              <CheckCircle className="w-3 h-3" /> {t("school.studied")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground text-xs">
                              <XCircle className="w-3 h-3" /> {t("school.notYet")}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm mb-3">
                          <div>
                            <span className="text-muted-foreground">{t("school.topicLabel")}: </span>
                            <span className="truncate">{student.topicStudied}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("school.trendLabel")}: </span>
                            {getTrendLabel(student.improvementTrend)}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewReport(student)}
                            className="flex-1 text-xs"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            {t("school.viewReport")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteDialog({ open: true, student })}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={deletingId === student.id}
                          >
                            {deletingId === student.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Rankings Tab */}
          <TabsContent value="rankings" className="mt-4 sm:mt-6">
            <Tabs value={rankingsTab} onValueChange={(v) => setRankingsTab(v as "school" | "district")} className="mb-4">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="school" className="flex items-center gap-2 text-xs sm:text-sm">
                  <Building2 className="w-3 h-3 sm:w-4 sm:h-4" />
                  School Rankings
                </TabsTrigger>
                <TabsTrigger value="district" className="flex items-center gap-2 text-xs sm:text-sm">
                  <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
                  {schoolDistrict || "District"}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {rankingsTab === "school" ? (
              <StudentRanking 
                rankings={rankings} 
                title="🏆 School Rankings"
                showTop={20}
              />
            ) : (
              <StudentRanking 
                rankings={districtRankings} 
                title={`🏆 ${schoolDistrict} District Rankings`}
                showTop={20}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Rejection Reason Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="max-w-sm sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">{t("school.rejectStudentTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-xs sm:text-sm text-muted-foreground">
                {t("school.rejectStudentDesc").split("{name}").join(rejectingStudent?.name ?? "")}
              </p>
            <Textarea
              placeholder={t("school.rejectReasonPlaceholder")}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setShowRejectDialog(false)} className="w-full sm:w-auto">
                {t("action.cancel")}
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleRejectStudent}
                disabled={approvingId === rejectingStudent?.id}
                className="w-full sm:w-auto"
              >
                {approvingId === rejectingStudent?.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <UserX className="w-4 h-4 mr-2" />
                )}
                {t("action.reject")} {t("school.table.student")}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Rejection Reason Dialog */}
      <Dialog open={showBulkRejectDialog} onOpenChange={setShowBulkRejectDialog}>
        <DialogContent className="max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              {t("school.rejectStudentsTitle").split("{count}").join(String(selectedPendingIds.size))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t("school.rejectStudentsDesc").split("{count}").join(String(selectedPendingIds.size))}
            </p>
            <Textarea
              placeholder={t("school.rejectReasonPlaceholder")}
              value={bulkRejectionReason}
              onChange={(e) => setBulkRejectionReason(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowBulkRejectDialog(false)} className="w-full sm:w-auto">
              {t("action.cancel")}
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleBulkReject}
              disabled={bulkProcessing}
              className="w-full sm:w-auto"
            >
              {bulkProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <UserX className="w-4 h-4 mr-2" />
              )}
              {t("school.rejectAllSelected")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Student Confirmation Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, student: null })}>
        <AlertDialogContent className="max-w-sm sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-destructive" />
              {t("school.removeStudentTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              {t("school.removeStudentDesc").split("{name}").join(deleteDialog.student?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 w-full sm:w-auto"
              onClick={() => deleteDialog.student && handleDeleteStudent(deleteDialog.student.id)}
              disabled={deletingId === deleteDialog.student?.id}
            >
              {deletingId === deleteDialog.student?.id ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Remove Student
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Student Report Modal */}
      {selectedStudent && (
        <StudentReportModal
          isOpen={showReportModal}
          onClose={() => {
            setShowReportModal(false);
            setSelectedStudent(null);
          }}
          studentId={selectedStudent.id}
          studentName={selectedStudent.name}
          studentPhoto={selectedStudent.photo}
          studentClass={selectedStudent.class}
          schoolId={schoolUuid || undefined}
          userType="school"
        />
      )}
    </div>
  );
};

export default SchoolDashboard;
