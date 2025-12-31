import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Shield,
  Users,
  Building2,
  LogOut,
  Plus,
  Search,
  TrendingUp,
  Send,
  FileText,
  Loader2,
  Eye,
  EyeOff,
  X,
  ClipboardList,
  Ban,
  DollarSign,
  CheckCircle,
  XCircle,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import StudentReportModal from "@/components/StudentReportModal";

interface School {
  id: string;
  school_id: string;
  name: string;
  district: string | null;
  state: string | null;
  studentCount: number;
  is_banned: boolean;
  fee_paid: boolean;
  email: string | null;
  contact_whatsapp: string | null;
}

interface Student {
  id: string;
  full_name: string;
  class: string;
  parent_whatsapp: string;
  school_name: string;
  photo_url?: string;
  is_banned: boolean;
  is_approved: boolean;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [adminName, setAdminName] = useState("Admin");
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"schools" | "students" | "reports" | "student-reports">("schools");
  
  // Add school modal state
  const [showAddSchool, setShowAddSchool] = useState(false);
  const [newSchool, setNewSchool] = useState({
    name: "",
    district: "",
    state: "Bihar",
    email: "",
    contact_whatsapp: "",
  });
  const [addingSchool, setAddingSchool] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ id: string; password: string } | null>(null);

  // Send report state
  const [sendingReportFor, setSendingReportFor] = useState<string | null>(null);

  // Student report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Ban/Delete confirmation states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: "ban" | "unban" | "delete" | "fee";
    entity: "school" | "student";
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    const storedAdminId = localStorage.getItem("adminId");
    const storedAdminName = localStorage.getItem("adminName");
    
    if (!storedAdminId) {
      navigate("/admin-login");
      return;
    }
    
    if (storedAdminName) {
      setAdminName(storedAdminName);
    }

    loadData();
  }, [navigate]);

  const loadData = async () => {
    try {
      // Load schools with student counts
      const { data: schoolsData } = await supabase.from("schools").select("*");
      const { data: studentsData } = await supabase.from("students").select("*, schools(name)");

      if (schoolsData && studentsData) {
        const schoolsWithCounts = schoolsData.map((school) => ({
          ...school,
          studentCount: studentsData.filter((s) => s.school_id === school.id).length,
          is_banned: school.is_banned || false,
          fee_paid: school.fee_paid !== false,
        }));
        setSchools(schoolsWithCounts);

        const formattedStudents = studentsData.map((s) => ({
          id: s.id,
          full_name: s.full_name,
          class: s.class,
          parent_whatsapp: s.parent_whatsapp,
          school_name: (s.schools as any)?.name || "No School",
          photo_url: s.photo_url || undefined,
          is_banned: s.is_banned || false,
          is_approved: s.is_approved || false,
        }));
        setStudents(formattedStudents);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateSchoolCredentials = (name: string) => {
    const prefix = name
      .split(" ")
      .map((word) => word.charAt(0).toLowerCase())
      .join("")
      .slice(0, 3);
    const suffix = "855108";
    const schoolId = `${prefix}${suffix}`;
    const password = `${prefix}kne${suffix}`;
    return { id: schoolId, password };
  };

  const handleAddSchool = async () => {
    if (!newSchool.name.trim()) {
      toast({
        title: "Error",
        description: "Please enter school name",
        variant: "destructive",
      });
      return;
    }

    setAddingSchool(true);
    const credentials = generateSchoolCredentials(newSchool.name);

    try {
      const { error } = await supabase.from("schools").insert({
        school_id: credentials.id,
        password_hash: credentials.password,
        name: newSchool.name,
        district: newSchool.district || null,
        state: newSchool.state || null,
        email: newSchool.email || null,
        contact_whatsapp: newSchool.contact_whatsapp || null,
      });

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "School Already Exists",
            description: "A school with similar credentials already exists.",
            variant: "destructive",
          });
        } else {
          throw error;
        }
      } else {
        setGeneratedCredentials(credentials);
        toast({
          title: "School Added!",
          description: `${newSchool.name} has been added successfully.`,
        });
        loadData();
      }
    } catch (error) {
      console.error("Error adding school:", error);
      toast({
        title: "Error",
        description: "Failed to add school. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAddingSchool(false);
    }
  };

  const handleBanSchool = async (schoolId: string, ban: boolean) => {
    setActionLoading(schoolId);
    try {
      const { error } = await supabase
        .from("schools")
        .update({ is_banned: ban })
        .eq("id", schoolId);

      if (error) throw error;

      setSchools(prev => prev.map(s => 
        s.id === schoolId ? { ...s, is_banned: ban } : s
      ));

      toast({
        title: ban ? "School Banned" : "School Unbanned",
        description: ban ? "School can no longer access the dashboard." : "School access has been restored.",
      });
    } catch (error) {
      console.error("Error updating school:", error);
      toast({
        title: "Error",
        description: "Failed to update school. Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleToggleFee = async (schoolId: string, paid: boolean) => {
    setActionLoading(schoolId);
    try {
      const { error } = await supabase
        .from("schools")
        .update({ fee_paid: paid })
        .eq("id", schoolId);

      if (error) throw error;

      setSchools(prev => prev.map(s => 
        s.id === schoolId ? { ...s, fee_paid: paid } : s
      ));

      toast({
        title: paid ? "Fee Marked as Paid" : "Fee Marked as Unpaid",
        description: paid ? "School can access the dashboard." : "School access has been suspended.",
      });
    } catch (error) {
      console.error("Error updating fee status:", error);
      toast({
        title: "Error",
        description: "Failed to update fee status. Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleDeleteSchool = async (schoolId: string) => {
    setActionLoading(schoolId);
    try {
      const { error } = await supabase
        .from("schools")
        .delete()
        .eq("id", schoolId);

      if (error) throw error;

      setSchools(prev => prev.filter(s => s.id !== schoolId));

      toast({
        title: "School Deleted",
        description: "School has been permanently removed.",
      });
    } catch (error) {
      console.error("Error deleting school:", error);
      toast({
        title: "Error",
        description: "Failed to delete school. It may have associated students.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleBanStudent = async (studentId: string, ban: boolean) => {
    setActionLoading(studentId);
    try {
      const { error } = await supabase
        .from("students")
        .update({ is_banned: ban })
        .eq("id", studentId);

      if (error) throw error;

      setStudents(prev => prev.map(s => 
        s.id === studentId ? { ...s, is_banned: ban } : s
      ));

      toast({
        title: ban ? "Student Banned" : "Student Unbanned",
        description: ban ? "Student can no longer access the platform." : "Student access has been restored.",
      });
    } catch (error) {
      console.error("Error updating student:", error);
      toast({
        title: "Error",
        description: "Failed to update student. Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    setActionLoading(studentId);
    try {
      const { error } = await supabase
        .from("students")
        .delete()
        .eq("id", studentId);

      if (error) throw error;

      setStudents(prev => prev.filter(s => s.id !== studentId));

      toast({
        title: "Student Deleted",
        description: "Student has been permanently removed.",
      });
    } catch (error) {
      console.error("Error deleting student:", error);
      toast({
        title: "Error",
        description: "Failed to delete student. Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
      setConfirmDialog(null);
    }
  };

  const handleSendReport = async (studentId: string, parentWhatsapp: string) => {
    setSendingReportFor(studentId);
    try {
      const { data, error } = await supabase.functions.invoke("send-weekly-report", {
        body: { studentId, testMode: true },
      });

      if (error) throw error;

      if (data?.success) {
        await supabase.from("parent_reports").insert({
          student_id: studentId,
          report_type: "manual",
          report_data: data.reportData || {},
          sent_at: new Date().toISOString(),
          sent_to: parentWhatsapp,
          created_by: localStorage.getItem("adminId"),
          created_by_type: "admin",
        });

        toast({
          title: "Report Sent!",
          description: `WhatsApp report sent to ${parentWhatsapp}`,
        });
      } else {
        throw new Error(data?.error || "Failed to send report");
      }
    } catch (error) {
      console.error("Error sending report:", error);
      toast({
        title: "Failed to send report",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSendingReportFor(null);
    }
  };

  const handleViewStudentReport = (student: Student) => {
    setSelectedStudent(student);
    setShowReportModal(true);
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  const filteredSchools = schools.filter((school) =>
    school.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredStudents = students.filter(
    (student) =>
      student.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.school_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = {
    totalStudents: students.length,
    totalSchools: schools.length,
    activeSchools: schools.filter((s) => s.studentCount > 0 && !s.is_banned && s.fee_paid).length,
    bannedSchools: schools.filter((s) => s.is_banned).length,
    unpaidSchools: schools.filter((s) => !s.fee_paid).length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-destructive flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Shield className="w-6 h-6 text-destructive-foreground" />
          </div>
          <p className="text-muted-foreground">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive flex items-center justify-center">
                <Shield className="w-6 h-6 text-destructive-foreground" />
              </div>
              <div>
                <span className="font-bold text-lg">Admin Panel</span>
                <p className="text-xs text-muted-foreground">Welcome, {adminName}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="edu-card p-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <p className="text-2xl font-bold">{stats.totalStudents}</p>
            <p className="text-sm text-muted-foreground">Total Students</p>
          </div>
          <div className="edu-card p-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
              <Building2 className="w-6 h-6 text-accent" />
            </div>
            <p className="text-2xl font-bold">{stats.totalSchools}</p>
            <p className="text-sm text-muted-foreground">Total Schools</p>
          </div>
          <div className="edu-card p-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <p className="text-2xl font-bold">{stats.activeSchools}</p>
            <p className="text-sm text-muted-foreground">Active Schools</p>
          </div>
          <div className="edu-card p-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-2">
              <Ban className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-2xl font-bold">{stats.bannedSchools}</p>
            <p className="text-sm text-muted-foreground">Banned</p>
          </div>
          <div className="edu-card p-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center mx-auto mb-2">
              <DollarSign className="w-6 h-6 text-warning" />
            </div>
            <p className="text-2xl font-bold">{stats.unpaidSchools}</p>
            <p className="text-sm text-muted-foreground">Unpaid Fees</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <Button
            variant={activeTab === "schools" ? "default" : "outline"}
            onClick={() => setActiveTab("schools")}
          >
            <Building2 className="w-4 h-4 mr-2" />
            Schools
          </Button>
          <Button
            variant={activeTab === "students" ? "default" : "outline"}
            onClick={() => setActiveTab("students")}
          >
            <Users className="w-4 h-4 mr-2" />
            Students
          </Button>
          <Button
            variant={activeTab === "reports" ? "default" : "outline"}
            onClick={() => setActiveTab("reports")}
          >
            <FileText className="w-4 h-4 mr-2" />
            Send Reports
          </Button>
          <Button
            variant={activeTab === "student-reports" ? "default" : "outline"}
            onClick={() => setActiveTab("student-reports")}
          >
            <ClipboardList className="w-4 h-4 mr-2" />
            Student Reports
          </Button>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {activeTab === "schools" && (
            <Dialog open={showAddSchool} onOpenChange={setShowAddSchool}>
              <DialogTrigger asChild>
                <Button variant="hero">
                  <Plus className="w-4 h-4 mr-2" />
                  Add School
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add New School</DialogTitle>
                </DialogHeader>
                {generatedCredentials ? (
                  <div className="space-y-4">
                    <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
                      <p className="font-semibold text-accent mb-2">School Added Successfully!</p>
                      <p className="text-sm text-muted-foreground mb-4">
                        Share these credentials with the school:
                      </p>
                      <div className="space-y-2 bg-background rounded-lg p-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">School ID:</span>
                          <span className="font-mono font-bold">{generatedCredentials.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Password:</span>
                          <span className="font-mono font-bold">{generatedCredentials.password}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setShowAddSchool(false);
                        setGeneratedCredentials(null);
                        setNewSchool({ name: "", district: "", state: "Bihar", email: "", contact_whatsapp: "" });
                      }}
                    >
                      Done
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="schoolName">School Name *</Label>
                      <Input
                        id="schoolName"
                        placeholder="Enter school name"
                        value={newSchool.name}
                        onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="district">District</Label>
                      <Input
                        id="district"
                        placeholder="e.g., Kishanganj"
                        value={newSchool.district}
                        onChange={(e) => setNewSchool({ ...newSchool, district: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        placeholder="e.g., Bihar"
                        value={newSchool.state}
                        onChange={(e) => setNewSchool({ ...newSchool, state: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email (for notifications)</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="school@example.com"
                        value={newSchool.email}
                        onChange={(e) => setNewSchool({ ...newSchool, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="whatsapp">WhatsApp (for notifications)</Label>
                      <Input
                        id="whatsapp"
                        placeholder="9876543210"
                        value={newSchool.contact_whatsapp}
                        onChange={(e) => setNewSchool({ ...newSchool, contact_whatsapp: e.target.value })}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleAddSchool}
                      disabled={addingSchool}
                    >
                      {addingSchool ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Add School
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Content */}
        {activeTab === "schools" && (
          <div className="edu-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/30">
              <h2 className="font-bold">Registered Schools</h2>
            </div>
            <div className="divide-y divide-border">
              {filteredSchools.map((school) => (
                <div key={school.id} className={`p-4 ${school.is_banned ? 'bg-destructive/5' : !school.fee_paid ? 'bg-warning/5' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${school.is_banned ? 'bg-destructive/10' : !school.fee_paid ? 'bg-warning/10' : 'bg-accent/10'}`}>
                        <Building2 className={`w-5 h-5 ${school.is_banned ? 'text-destructive' : !school.fee_paid ? 'text-warning' : 'text-accent'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{school.name}</p>
                          {school.is_banned && (
                            <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">Banned</span>
                          )}
                          {!school.fee_paid && !school.is_banned && (
                            <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">Unpaid</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          ID: {school.school_id} • {school.district || "N/A"} • {school.studentCount} students
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Fee Toggle */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDialog({
                          open: true,
                          type: "fee",
                          entity: "school",
                          id: school.id,
                          name: school.name,
                        })}
                        disabled={actionLoading === school.id}
                        className={school.fee_paid ? "text-accent" : "text-warning"}
                      >
                        <DollarSign className="w-4 h-4 mr-1" />
                        {school.fee_paid ? "Paid" : "Unpaid"}
                      </Button>
                      
                      {/* Ban/Unban */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDialog({
                          open: true,
                          type: school.is_banned ? "unban" : "ban",
                          entity: "school",
                          id: school.id,
                          name: school.name,
                        })}
                        disabled={actionLoading === school.id}
                        className={school.is_banned ? "text-accent" : "text-destructive"}
                      >
                        {school.is_banned ? <CheckCircle className="w-4 h-4 mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
                        {school.is_banned ? "Unban" : "Ban"}
                      </Button>
                      
                      {/* Delete */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDialog({
                          open: true,
                          type: "delete",
                          entity: "school",
                          id: school.id,
                          name: school.name,
                        })}
                        disabled={actionLoading === school.id}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredSchools.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No schools found.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "students" && (
          <div className="edu-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/30">
              <h2 className="font-bold">All Students</h2>
            </div>
            <div className="divide-y divide-border">
              {filteredStudents.map((student) => (
                <div key={student.id} className={`p-4 ${student.is_banned ? 'bg-destructive/5' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {student.photo_url ? (
                        <img 
                          src={student.photo_url} 
                          alt={student.full_name}
                          className={`w-10 h-10 rounded-full object-cover border-2 ${student.is_banned ? 'border-destructive/30' : 'border-primary/20'}`}
                        />
                      ) : (
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${student.is_banned ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                          {student.full_name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{student.full_name}</p>
                          {student.is_banned && (
                            <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">Banned</span>
                          )}
                          {!student.is_approved && !student.is_banned && (
                            <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">Pending</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {student.class} • {student.school_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Ban/Unban */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDialog({
                          open: true,
                          type: student.is_banned ? "unban" : "ban",
                          entity: "student",
                          id: student.id,
                          name: student.full_name,
                        })}
                        disabled={actionLoading === student.id}
                        className={student.is_banned ? "text-accent" : "text-destructive"}
                      >
                        {student.is_banned ? <CheckCircle className="w-4 h-4 mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
                        {student.is_banned ? "Unban" : "Ban"}
                      </Button>
                      
                      {/* Delete */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDialog({
                          open: true,
                          type: "delete",
                          entity: "student",
                          id: student.id,
                          name: student.full_name,
                        })}
                        disabled={actionLoading === student.id}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredStudents.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No students found.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="edu-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/30">
              <h2 className="font-bold">Send Parent Reports</h2>
              <p className="text-sm text-muted-foreground">
                Send manual progress reports to parents via WhatsApp
              </p>
            </div>
            <div className="divide-y divide-border">
              {filteredStudents.filter(s => !s.is_banned).map((student) => (
                <div key={student.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold">
                      {student.full_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold">{student.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {student.class} • {student.parent_whatsapp}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSendReport(student.id, student.parent_whatsapp)}
                    disabled={sendingReportFor === student.id}
                  >
                    {sendingReportFor === student.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Report
                      </>
                    )}
                  </Button>
                </div>
              ))}
              {filteredStudents.filter(s => !s.is_banned).length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No students found.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "student-reports" && (
          <div className="edu-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/30">
              <h2 className="font-bold">Student Report Generator</h2>
              <p className="text-sm text-muted-foreground">
                View detailed study reports for any student (weekly summary, weak areas, AI feedback)
              </p>
            </div>
            <div className="divide-y divide-border">
              {filteredStudents.filter(s => !s.is_banned).map((student) => (
                <div key={student.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {student.photo_url ? (
                      <img 
                        src={student.photo_url} 
                        alt={student.full_name}
                        className="w-10 h-10 rounded-full object-cover border-2 border-primary/20"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold">
                        {student.full_name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold">{student.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {student.class} • {student.school_name}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewStudentReport(student)}
                  >
                    <ClipboardList className="w-4 h-4 mr-2" />
                    View Report
                  </Button>
                </div>
              ))}
              {filteredStudents.filter(s => !s.is_banned).length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No students found.
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog?.open} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Confirm Action
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.type === "ban" && `Are you sure you want to ban ${confirmDialog.name}? They will lose access to the platform.`}
              {confirmDialog?.type === "unban" && `Are you sure you want to unban ${confirmDialog.name}? They will regain access to the platform.`}
              {confirmDialog?.type === "delete" && `Are you sure you want to permanently delete ${confirmDialog.name}? This action cannot be undone.`}
              {confirmDialog?.type === "fee" && confirmDialog.entity === "school" && (
                schools.find(s => s.id === confirmDialog.id)?.fee_paid
                  ? `Mark ${confirmDialog.name}'s fee as unpaid? They will lose dashboard access.`
                  : `Mark ${confirmDialog.name}'s fee as paid? They will regain dashboard access.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirmDialog?.type === "delete" || confirmDialog?.type === "ban" ? "bg-destructive hover:bg-destructive/90" : ""}
              onClick={() => {
                if (!confirmDialog) return;
                
                if (confirmDialog.type === "ban") {
                  if (confirmDialog.entity === "school") handleBanSchool(confirmDialog.id, true);
                  else handleBanStudent(confirmDialog.id, true);
                } else if (confirmDialog.type === "unban") {
                  if (confirmDialog.entity === "school") handleBanSchool(confirmDialog.id, false);
                  else handleBanStudent(confirmDialog.id, false);
                } else if (confirmDialog.type === "delete") {
                  if (confirmDialog.entity === "school") handleDeleteSchool(confirmDialog.id);
                  else handleDeleteStudent(confirmDialog.id);
                } else if (confirmDialog.type === "fee") {
                  const school = schools.find(s => s.id === confirmDialog.id);
                  if (school) handleToggleFee(confirmDialog.id, !school.fee_paid);
                }
              }}
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Confirm"
              )}
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
          studentName={selectedStudent.full_name}
          studentPhoto={selectedStudent.photo_url}
          studentClass={selectedStudent.class}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
