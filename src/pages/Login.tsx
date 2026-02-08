import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import AuthRepairButton from "@/components/AuthRepairButton";
import { useLanguage } from "@/contexts/LanguageContext";
import { loginSchema, validateForm } from "@/lib/validation";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, user } = useAuth();
  const { t, language } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showAuthRepair, setShowAuthRepair] = useState(false);

  // Check for pending signup and create profile if needed
  useEffect(() => {
    const handlePendingSignup = async () => {
      if (!user) return;
      
      const pendingData = localStorage.getItem("pendingSignup");
      if (!pendingData) return;
      
      try {
        const data = JSON.parse(pendingData);
        
        // Check if student profile already exists
        const { data: existingProfile } = await supabase
          .from("students")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        
        if (existingProfile) {
          // Profile already exists, clear pending data
          localStorage.removeItem("pendingSignup");
          return;
        }
        
        // Upload photo if available (from base64)
        let photoUrl = null;
        if (data.photoFile) {
          try {
            // Convert base64 to blob
            const response = await fetch(data.photoFile);
            const blob = await response.blob();
            const fileName = `${user.id}/${Date.now()}.jpg`;
            
            const { error: uploadError } = await supabase.storage
              .from('student-photos')
              .upload(fileName, blob);

            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage
                .from('student-photos')
                .getPublicUrl(fileName);
              photoUrl = publicUrl;
            }
          } catch (uploadErr) {
            console.error("Photo upload error:", uploadErr);
          }
        }
        
        // Create student profile
        const { error: profileError } = await supabase
          .from("students")
          .insert({
            user_id: user.id,
            photo_url: photoUrl,
            full_name: data.fullName,
            phone: data.phone,
            parent_whatsapp: data.parentWhatsapp,
            class: data.class,
            age: parseInt(data.age),
            board: data.board,
            school_id: data.schoolId,
            district: data.district,
            state: data.state,
          });

        if (profileError) {
          console.error("Profile creation error:", profileError);
        } else {
          toast({
            title: "Profile Created!",
            description: "Your student profile has been set up successfully.",
          });
        }
        
        // Clear pending data
        localStorage.removeItem("pendingSignup");
        
        // Navigate to dashboard
        navigate("/dashboard");
      } catch (err) {
        console.error("Error processing pending signup:", err);
        localStorage.removeItem("pendingSignup");
      }
    };
    
    handlePendingSignup();
  }, [user, navigate, toast]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs
    const validation = validateForm(loginSchema, { email, password });
    if (!validation.success && 'errors' in validation) {
      const firstError = Object.values(validation.errors)[0];
      toast({
        title: language === 'en' ? "Validation Error" : "वैलिडेशन एरर",
        description: firstError,
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);
      
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast({
            title: language === 'en' ? "Login Failed" : "लॉगिन फेल",
            description: language === 'en' ? "Invalid email or password. Please try again." : "गलत ईमेल या पासवर्ड।",
            variant: "destructive",
          });
        } else if (error.message.includes("Email not confirmed")) {
          toast({
            title: language === 'en' ? "Email Not Verified" : "ईमेल वेरिफाई नहीं हुआ",
            description: language === 'en' ? "Please check your email and click the verification link." : "कृपया अपना ईमेल चेक करें और वेरिफिकेशन लिंक पर क्लिक करें।",
            variant: "destructive",
          });
        } else {
          setShowAuthRepair(true);
          throw error;
        }
        setIsLoading(false);
        return;
      }

      toast({
        title: language === 'en' ? "Welcome back!" : "वापस स्वागत है!",
        description: language === 'en' ? "Let's start studying together." : "चलो साथ में पढ़ाई करते हैं।",
      });
      navigate("/dashboard");
    } catch (error) {
      console.error("Login error:", error);
      setShowAuthRepair(true);
      toast({
        title: language === 'en' ? "Login Failed" : "लॉगिन फेल",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen hero-gradient flex flex-col">
      {/* Header */}
      <header className="container mx-auto py-4 px-3 sm:px-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden xs:inline">{language === 'en' ? 'Back to Home' : 'वापस होम'}</span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Login Form */}
      <main className="flex-1 container mx-auto px-3 sm:px-4 flex items-center justify-center py-4 sm:py-8">
        <div className="w-full max-w-md">
          <div className="edu-card p-4 sm:p-6 md:p-8">
            <div className="text-center mb-6 sm:mb-8">
              <img 
                src="/logo.png" 
                alt="Study Buddy AI" 
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mx-auto mb-3 sm:mb-4 object-contain"
              />
              <h1 className="text-xl sm:text-2xl font-bold">
                {language === 'en' ? 'Welcome Back!' : 'वापस स्वागत है!'}
              </h1>
              <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
                {language === 'en' ? 'Login to continue studying' : 'पढ़ाई जारी रखने के लिए लॉगिन करें'}
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <Label htmlFor="email">{language === 'en' ? 'Email' : 'ईमेल'}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12"
                />
              </div>

              <div>
                <Label htmlFor="password">{language === 'en' ? 'Password' : 'पासवर्ड'}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={language === 'en' ? "Enter your password" : "अपना पासवर्ड डालें"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-12"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <div className="flex justify-end mt-2">
                  <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                    {language === 'en' ? 'Forgot password?' : 'पासवर्ड भूल गए?'}
                  </Link>
                </div>
              </div>

              <Button type="submit" variant="hero" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? (language === 'en' ? "Logging in..." : "लॉगिन हो रहा है...") : (language === 'en' ? "Login" : "लॉगिन")}
              </Button>
            </form>

            {/* Auth Repair Button */}
            {showAuthRepair && (
              <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20">
                <p className="text-sm text-muted-foreground mb-2">
                  {language === 'en' ? 'Having trouble logging in?' : 'लॉगिन में परेशानी?'}
                </p>
                <AuthRepairButton 
                  onRepaired={() => setShowAuthRepair(false)} 
                  className="w-full"
                />
              </div>
            )}

            <div className="mt-6 text-center">
              <p className="text-muted-foreground">
                {language === 'en' ? "Don't have an account?" : "अकाउंट नहीं है?"}{" "}
                <Link to="/signup" className="text-primary font-semibold hover:underline">
                  {language === 'en' ? 'Sign Up' : 'साइन अप'}
                </Link>
              </p>
            </div>

            <div className="mt-4 pt-4 border-t border-border text-center">
              <Link to="/school-login" className="text-sm text-muted-foreground hover:text-primary">
                {language === 'en' ? 'School Admin? Login here →' : 'स्कूल एडमिन? यहां लॉगिन करें →'}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
