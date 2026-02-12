import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, ArrowLeft, Eye, EyeOff, Camera, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { signupSchema, validateForm } from "@/lib/validation";

interface School {
  id: string;
  name: string;
  school_id: string;
}

const Signup = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signUp } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    parentWhatsapp: "",
    class: "",
    age: "",
    board: "CBSE" as "CBSE" | "ICSE" | "Bihar Board" | "Other",
    district: "",
    state: "",
    email: "",
    password: "",
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Load schools on mount
  useEffect(() => {
    const loadSchools = async () => {
      const { data, error } = await supabase.functions.invoke("get-schools-public", {
        body: { action: "list" },
      });

      if (error || data?.error) {
        console.error("Load schools error:", error || data?.error);
        return;
      }

      const list = (data?.schools as School[]) ?? [];
      setSchools(list);
      if (list.length > 0) {
        setSelectedSchoolId(list[0].id);
      }
    };

    loadSchools();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Photo too large",
          description: "Please upload a photo smaller than 5MB",
          variant: "destructive"
        });
        return;
      }
      
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors({});
    
    // Validate form data
    const validation = validateForm(signupSchema, formData);
    if (!validation.success && 'errors' in validation) {
      setValidationErrors(validation.errors);
      toast({
        title: "Validation Error",
        description: "Please fix the errors in the form",
        variant: "destructive",
      });
      return;
    }
    
    // Photo is optional - students can sign up without uploading a photo

    if (!selectedSchoolId) {
      toast({
        title: "School Required",
        description: "Please select your school.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Sign up with Supabase Auth
      const { error: authError, data: authData } = await signUp(formData.email, formData.password, {
        full_name: formData.fullName,
        phone: formData.phone,
        class: formData.class,
        age: formData.age,
        board: formData.board,
        district: formData.district,
        state: formData.state,
        parent_whatsapp: formData.parentWhatsapp,
        school_id: selectedSchoolId,
      });

      if (authError) {
        if (authError.message.includes("already registered") || authError.message.includes("already been registered")) {
          toast({
            title: "Account exists",
            description: "This email is already registered. Please login instead.",
            variant: "destructive",
          });
        } else {
          throw authError;
        }
        setIsLoading(false);
        return;
      }

      // Check if user was created - for repeated signups, user might be null
      const user = authData?.user;
      
      if (!user) {
        // This happens when email already exists (user_repeated_signup)
        toast({
          title: "Email Already Registered",
          description: "This email is already registered. Please login instead.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      // Check if user's identities is empty (another sign of existing account)
      if (user.identities && user.identities.length === 0) {
        toast({
          title: "Email Already Registered",
          description: "This email is already registered. Please login instead.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      // Create student profile
      await createStudentProfile(user.id);
      
      toast({
        title: "Account Created! 🎉",
        description: "Your account is pending school approval. You'll be notified once approved.",
      });
      
      // Navigate to login
      navigate("/login");
    } catch (error) {
      console.error("Signup error:", error);
      toast({
        title: "Signup Failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const createStudentProfile = async (userId: string) => {
    let photoUrl: string | null = null;

    // Upload photo to Supabase Storage
    if (photoFile) {
      const fileExt = photoFile.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('student-photos')
        .upload(fileName, photoFile);

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        // Continue without photo rather than blocking signup
      } else {
        const { data: { publicUrl } } = supabase.storage
          .from('student-photos')
          .getPublicUrl(fileName);
        photoUrl = publicUrl;
      }
    }

    // Create student profile with the selected school
    const { error: profileError } = await supabase
      .from("students")
      .insert({
        user_id: userId,
        photo_url: photoUrl,
        full_name: formData.fullName,
        phone: formData.phone,
        parent_whatsapp: formData.parentWhatsapp,
        class: formData.class,
        age: parseInt(formData.age),
        board: formData.board,
        school_id: selectedSchoolId,
        district: formData.district.trim(),
        state: formData.state.trim(),
      });

    if (profileError) {
      console.error("Profile creation error:", profileError);
      throw new Error("Failed to create student profile. Please try again.");
    }
  };

  return (
    <div className="min-h-screen hero-gradient">
      {/* Header */}
      <header className="container mx-auto py-4 px-3 sm:px-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </Link>
      </header>

      {/* Signup Form */}
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="max-w-2xl mx-auto">
          <div className="edu-card p-4 sm:p-6 md:p-8">
            <div className="text-center mb-6 sm:mb-8">
              <img 
                src="/logo.png" 
                alt="Study Buddy AI" 
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mx-auto mb-3 sm:mb-4 object-contain"
              />
              <h1 className="text-xl sm:text-2xl font-bold">Create Your Account</h1>
              <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">Join Study Buddy AI and start improving</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              {/* Photo Upload */}
              <div className="flex flex-col items-center">
                <Label className="mb-2 sm:mb-3 text-sm">Student Photo (Optional)</Label>
                <div
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl sm:rounded-2xl border-2 border-dashed border-input bg-muted flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Camera className="w-6 h-6 sm:w-8 sm:h-8 mx-auto mb-1 sm:mb-2" />
                      <span className="text-xs">Upload Photo</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label htmlFor="fullName" className="text-sm">Full Name *</Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    placeholder="Enter your full name"
                    value={formData.fullName}
                    onChange={handleInputChange}
                    required
                    className={`h-10 sm:h-12 text-sm ${validationErrors.fullName ? 'border-destructive' : ''}`}
                  />
                  {validationErrors.fullName && <p className="text-xs text-destructive mt-1">{validationErrors.fullName}</p>}
                </div>
                <div>
                  <Label htmlFor="phone" className="text-sm">Phone Number *</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="Your phone number"
                    value={formData.phone}
                    onChange={handleInputChange}
                    required
                    className={`h-10 sm:h-12 text-sm ${validationErrors.phone ? 'border-destructive' : ''}`}
                  />
                  {validationErrors.phone && <p className="text-xs text-destructive mt-1">{validationErrors.phone}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label htmlFor="parentWhatsapp" className="text-sm">Parent WhatsApp *</Label>
                  <Input
                    id="parentWhatsapp"
                    name="parentWhatsapp"
                    type="tel"
                    placeholder="Parent's WhatsApp number"
                    value={formData.parentWhatsapp}
                    onChange={handleInputChange}
                    required
                    className={`h-10 sm:h-12 text-sm ${validationErrors.parentWhatsapp ? 'border-destructive' : ''}`}
                  />
                  {validationErrors.parentWhatsapp && <p className="text-xs text-destructive mt-1">{validationErrors.parentWhatsapp}</p>}
                </div>
                <div>
                  <Label htmlFor="email" className="text-sm">Email *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="your.email@example.com"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className={`h-10 sm:h-12 text-sm ${validationErrors.email ? 'border-destructive' : ''}`}
                  />
                  {validationErrors.email && <p className="text-xs text-destructive mt-1">{validationErrors.email}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div>
                  <Label htmlFor="class" className="text-sm">Class *</Label>
                  <select
                    id="class"
                    name="class"
                    className="flex h-10 sm:h-12 w-full rounded-lg sm:rounded-xl border border-input bg-background px-2 sm:px-4 py-2 sm:py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={formData.class}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">Class</option>
                    {[...Array(12)].map((_, i) => (
                      <option key={i + 1} value={`Class ${i + 1}`}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="age" className="text-sm">Age *</Label>
                  <Input
                    id="age"
                    name="age"
                    type="number"
                    min="5"
                    max="25"
                    placeholder="Age"
                    value={formData.age}
                    onChange={handleInputChange}
                    required
                    className="h-10 sm:h-12 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="board" className="text-sm">Board *</Label>
                  <select
                    id="board"
                    name="board"
                    className="flex h-10 sm:h-12 w-full rounded-lg sm:rounded-xl border border-input bg-background px-2 sm:px-4 py-2 sm:py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={formData.board}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="CBSE">CBSE</option>
                    <option value="ICSE">ICSE</option>
                    <option value="Bihar Board">Bihar</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="schoolId" className="text-sm">School *</Label>
                <select
                  id="schoolId"
                  name="schoolId"
                  className="flex h-10 sm:h-12 w-full rounded-lg sm:rounded-xl border border-input bg-background px-3 sm:px-4 py-2 sm:py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(e.target.value)}
                  required
                >
                  <option value="">Select School</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <Label htmlFor="district" className="text-sm">District *</Label>
                  <Input
                    id="district"
                    name="district"
                    placeholder="Your district"
                    value={formData.district}
                    onChange={handleInputChange}
                    required
                    className="h-10 sm:h-12 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="state" className="text-sm">State *</Label>
                  <Input
                    id="state"
                    name="state"
                    placeholder="Your state"
                    value={formData.state}
                    onChange={handleInputChange}
                    required
                    className="h-10 sm:h-12 text-sm"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="text-sm">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a strong password"
                    value={formData.password}
                    onChange={handleInputChange}
                    required
                    minLength={6}
                    className="h-10 sm:h-12 text-sm"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                </div>
              </div>

              {/* Terms & Conditions */}
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="termsAccepted"
                  required
                  className="mt-0.5 h-4 w-4 rounded border-input flex-shrink-0"
                />
                <label htmlFor="termsAccepted" className="text-xs sm:text-sm text-muted-foreground">
                  I agree to the{" "}
                  <Link to="/terms" className="text-primary hover:underline font-medium" target="_blank">
                    Terms & Conditions
                  </Link>{" "}
                  of Study Buddy AI
                </label>
              </div>

              <Button type="submit" variant="hero" className="w-full text-sm sm:text-base" size="lg" disabled={isLoading}>
                {isLoading ? "Creating Account..." : "Create Account & Start Studying"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary font-semibold hover:underline">
                  Login
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Signup;
