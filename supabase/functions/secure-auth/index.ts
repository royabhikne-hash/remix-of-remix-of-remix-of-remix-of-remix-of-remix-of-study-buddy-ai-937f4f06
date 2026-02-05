import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const bcryptAny: any = bcrypt;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Session token expiration: 60 days (for persistent login)
const SESSION_EXPIRY_DAYS = 60;
const SESSION_EXPIRY_HOURS = SESSION_EXPIRY_DAYS * 24;

// Simple in-memory rate limiting (resets on function cold start)
const loginAttempts = new Map<string, { count: number; lastAttempt: number; blockedUntil: number }>();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes block

function checkRateLimit(identifier: string): { allowed: boolean; waitSeconds?: number } {
  const now = Date.now();
  const record = loginAttempts.get(identifier);

  if (!record) {
    return { allowed: true };
  }

  if (record.blockedUntil > now) {
    return { 
      allowed: false, 
      waitSeconds: Math.ceil((record.blockedUntil - now) / 1000) 
    };
  }

  if (now - record.lastAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION;
    return { 
      allowed: false, 
      waitSeconds: Math.ceil(BLOCK_DURATION / 1000) 
    };
  }

  return { allowed: true };
}

function recordAttempt(identifier: string, success: boolean) {
  const now = Date.now();
  const record = loginAttempts.get(identifier);

  if (success) {
    loginAttempts.delete(identifier);
    return;
  }

  if (!record) {
    loginAttempts.set(identifier, { count: 1, lastAttempt: now, blockedUntil: 0 });
  } else {
    record.count++;
    record.lastAttempt = now;
  }
}

// Generate cryptographically secure credentials
function generateSecureCredentials(): { id: string; password: string } {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const idLength = 12;
  const passLength = 16;
  
  let id = 'SCH_';
  let password = '';
  
  const randomBytes = crypto.getRandomValues(new Uint8Array(idLength + passLength));
  
  for (let i = 0; i < idLength; i++) {
    id += chars[randomBytes[i] % chars.length];
  }
  
  for (let i = 0; i < passLength; i++) {
    password += chars[randomBytes[idLength + i] % chars.length];
  }
  
  return { id, password };
}

// Bcrypt password hashing (bcryptjs - compatible with edge runtime)
async function hashPassword(password: string): Promise<string> {
  const salt = bcryptAny.genSaltSync(12);
  return bcryptAny.hashSync(password, salt);
}

// Legacy SHA-256 hash for migration (to check old passwords)
async function legacyHashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.slice(0, 32));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string comparison
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let result = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyPassword(password: string, storedHash: string): Promise<{ valid: boolean; isLegacy: boolean; hashType: 'bcrypt' | 'sha256' | 'plaintext' }> {
  // Check if it's a bcrypt hash (starts with $2a$, $2b$, or $2y$)
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    const valid = !!bcryptAny.compareSync(password, storedHash);
    return { valid, isLegacy: false, hashType: 'bcrypt' };
  }

  // Check if it's a SHA-256 hash (64 hex characters)
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacyHash = await legacyHashPassword(password);
    const valid = secureCompare(legacyHash, storedHash);
    return { valid, isLegacy: true, hashType: 'sha256' };
  }
  
  // Plaintext password (legacy - force reset)
  const valid = secureCompare(password, storedHash);
  return { valid, isLegacy: true, hashType: 'plaintext' };
}

// Create session token in database
async function createSessionToken(
  supabase: any,
  userId: string,
  userType: 'admin' | 'school',
  clientIp: string,
  userAgent: string
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

  const { error } = await supabase.from('session_tokens').insert({
    token,
    user_id: userId,
    user_type: userType,
    expires_at: expiresAt.toISOString(),
    ip_address: clientIp,
    user_agent: userAgent,
  });

  if (error) {
    console.error("Create session token error:", error);
    throw new Error("Failed to create session");
  }

  return token;
}

// Validate session token from database
async function validateSessionToken(
  supabase: any,
  token: string,
  expectedUserType?: 'admin' | 'school'
): Promise<{ valid: boolean; userId?: string; userType?: string }> {
  const { data, error } = await supabase
    .from('session_tokens')
    .select('user_id, user_type, expires_at, is_revoked')
    .eq('token', token)
    .maybeSingle();
  
  if (error || !data) {
    return { valid: false };
  }
  
  if (data.is_revoked || new Date(data.expires_at) < new Date()) {
    return { valid: false };
  }
  
  if (expectedUserType && data.user_type !== expectedUserType) {
    return { valid: false };
  }
  
  return { valid: true, userId: data.user_id, userType: data.user_type };
}

// Revoke all sessions for a user
async function revokeUserSessions(
  supabase: any,
  userId: string,
  userType: 'admin' | 'school'
): Promise<void> {
  const { error } = await supabase
    .from('session_tokens')
    .update({ is_revoked: true })
    .eq('user_id', userId)
    .eq('user_type', userType);

  if (error) {
    console.error("Revoke sessions error:", error);
    throw new Error("Failed to revoke sessions");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, userType, identifier, password, newPassword, schoolData, adminCredentials, sessionToken, adminName, secretKey, studentData } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('cf-connecting-ip') || 
                     'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const rateLimitKey = `${userType}:${identifier || clientIp}`;

    if (action === "login") {
      const rateCheck = checkRateLimit(rateLimitKey);
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ 
            error: `Too many login attempts. Please try again in ${rateCheck.waitSeconds} seconds.`,
            rateLimited: true,
            waitSeconds: rateCheck.waitSeconds
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (userType === "admin") {
        const { data: admin, error } = await supabase
          .from("admins")
          .select("*")
          .eq("admin_id", identifier)
          .maybeSingle();

        if (error || !admin) {
          recordAttempt(rateLimitKey, false);
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const passwordResult = await verifyPassword(password, admin.password_hash);
        
        if (!passwordResult.valid) {
          recordAttempt(rateLimitKey, false);
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        recordAttempt(rateLimitKey, true);

        // Check if password reset is required (legacy password)
        const requiresPasswordReset = passwordResult.isLegacy || admin.password_reset_required;

        // If legacy password, upgrade it now
        if (passwordResult.isLegacy && !requiresPasswordReset) {
          const newHash = await hashPassword(password);
          await supabase
            .from("admins")
            .update({ password_hash: newHash, password_updated_at: new Date().toISOString() })
            .eq("id", admin.id);
        }

        const token = await createSessionToken(supabase, admin.id, 'admin', clientIp, userAgent);

        await supabase.from("login_attempts").insert({
          identifier: identifier,
          attempt_type: "admin",
          ip_address: clientIp,
          success: true
        });

        return new Response(
          JSON.stringify({ 
            success: true,
            user: {
              id: admin.id,
              name: admin.name,
              role: admin.role,
              adminId: admin.admin_id
            },
            sessionToken: token,
            requiresPasswordReset: requiresPasswordReset
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } else if (userType === "school") {
        const { data: school, error } = await supabase
          .from("schools")
          .select("*")
          .eq("school_id", identifier)
          .maybeSingle();

        if (error || !school) {
          recordAttempt(rateLimitKey, false);
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (school.is_banned) {
          return new Response(
            JSON.stringify({ error: "This school account has been suspended" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const passwordResult = await verifyPassword(password, school.password_hash);
        
        if (!passwordResult.valid) {
          recordAttempt(rateLimitKey, false);
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        recordAttempt(rateLimitKey, true);

        // Check if password reset is required
        const requiresPasswordReset = passwordResult.isLegacy || school.password_reset_required;

        // If legacy password and not forcing reset, upgrade silently
        if (passwordResult.isLegacy && !requiresPasswordReset) {
          const newHash = await hashPassword(password);
          await supabase
            .from("schools")
            .update({ password_hash: newHash, password_updated_at: new Date().toISOString() })
            .eq("id", school.id);
        }

        const token = await createSessionToken(supabase, school.id, 'school', clientIp, userAgent);

        await supabase.from("login_attempts").insert({
          identifier: identifier,
          attempt_type: "school",
          ip_address: clientIp,
          success: true
        });

        return new Response(
          JSON.stringify({ 
            success: true,
            user: {
              id: school.id,
              schoolId: school.school_id,
              name: school.name,
              feePaid: school.fee_paid
            },
            sessionToken: token,
            requiresPasswordReset: requiresPasswordReset
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Invalid user type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "reset_password") {
      // Reset password for admin or school
      if (!sessionToken || !newPassword) {
        return new Response(
          JSON.stringify({ error: "Session token and new password required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (newPassword.length < 8) {
        return new Response(
          JSON.stringify({ error: "Password must be at least 8 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, sessionToken);
      if (!validation.valid || !validation.userId || !validation.userType) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newHash = await hashPassword(newPassword);
      const table = validation.userType === 'admin' ? 'admins' : 'schools';

      const { error: updateError } = await supabase
        .from(table)
        .update({
          password_hash: newHash,
          password_reset_required: false,
          password_updated_at: new Date().toISOString(),
        })
        .eq("id", validation.userId);

      if (updateError) {
        console.error("Reset password update error:", updateError);
        return new Response(
          JSON.stringify({ error: "Password update failed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Revoke all old sessions and create a new one
      await revokeUserSessions(supabase, validation.userId, validation.userType as 'admin' | 'school');
      const newToken = await createSessionToken(
        supabase,
        validation.userId,
        validation.userType as 'admin' | 'school',
        clientIp,
        userAgent
      );

      return new Response(
        JSON.stringify({ success: true, sessionToken: newToken }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "validate_session") {
      // Validate a session token
      if (!sessionToken) {
        return new Response(
          JSON.stringify({ valid: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, sessionToken, userType);
      return new Response(
        JSON.stringify({ valid: validation.valid, userId: validation.userId, userType: validation.userType }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "logout") {
      // Revoke the session token
      if (sessionToken) {
        await supabase
          .from('session_tokens')
          .update({ is_revoked: true })
          .eq('token', sessionToken);
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "create_school") {
      // Verify admin session token
      if (!adminCredentials?.sessionToken) {
        return new Response(
          JSON.stringify({ error: "Admin authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, adminCredentials.sessionToken, 'admin');
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired admin session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const credentials = generateSecureCredentials();
      const hashedPassword = await hashPassword(credentials.password);

      const { data: newSchool, error } = await supabase
        .from("schools")
        .insert({
          school_id: credentials.id,
          password_hash: hashedPassword,
          name: schoolData.name,
          district: schoolData.district || null,
          state: schoolData.state || null,
          email: schoolData.email || null,
          contact_whatsapp: schoolData.contact_whatsapp || null,
          password_updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("Create school error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          school: newSchool,
          credentials: {
            id: credentials.id,
            password: credentials.password
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "update_school") {
      if (!adminCredentials?.sessionToken) {
        return new Response(
          JSON.stringify({ error: "Admin authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, adminCredentials.sessionToken, 'admin');
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired admin session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { schoolId, updates } = schoolData;

      const { error } = await supabase
        .from("schools")
        .update(updates)
        .eq("id", schoolId);

      if (error) {
        console.error("Update school error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "delete_school") {
      if (!adminCredentials?.sessionToken) {
        return new Response(
          JSON.stringify({ error: "Admin authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, adminCredentials.sessionToken, 'admin');
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired admin session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("schools")
        .delete()
        .eq("id", schoolData.schoolId);

      if (error) {
        console.error("Delete school error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "get_students_for_school") {
      const { schoolUuid, sessionToken: schoolSession } = schoolData;

      if (!schoolUuid || !schoolSession) {
        return new Response(
          JSON.stringify({ error: "School authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, schoolSession, 'school');
      if (!validation.valid || validation.userId !== schoolUuid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired school session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: students, error } = await supabase
        .from("students")
        .select("*")
        .eq("school_id", schoolUuid);

      if (error) {
        console.error("Get students error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, students }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "force_password_reset") {
      // Admin action to force password reset for a school
      if (!adminCredentials?.sessionToken) {
        return new Response(
          JSON.stringify({ error: "Admin authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validation = await validateSessionToken(supabase, adminCredentials.sessionToken, 'admin');
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired admin session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { schoolId } = schoolData;

      // Generate new password and force reset
      const newPassword = generateSecureCredentials().password;
      const hashedPassword = await hashPassword(newPassword);

      await supabase
        .from("schools")
        .update({ 
          password_hash: hashedPassword, 
          password_reset_required: true,
          password_updated_at: new Date().toISOString()
        })
        .eq("id", schoolId);

      // Revoke all existing sessions
      await revokeUserSessions(supabase, schoolId, 'school');

      return new Response(
        JSON.stringify({ success: true, newPassword }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (action === "create_admin") {
    } else if (action === "reset_student_password") {
      // Admin or School action to reset a student password
      // Validate caller credentials
      let isAuthorized = false;
      let callerType: 'admin' | 'school' | null = null;
      let callerSchoolId: string | null = null;

      if (adminCredentials?.sessionToken) {
        const validation = await validateSessionToken(supabase, adminCredentials.sessionToken, 'admin');
        if (validation.valid) {
          isAuthorized = true;
          callerType = 'admin';
        }
      }

      if (!isAuthorized && studentData?.schoolSessionToken && studentData?.schoolId) {
        const validation = await validateSessionToken(supabase, studentData.schoolSessionToken, 'school');
        if (validation.valid && validation.userId === studentData.schoolId) {
          isAuthorized = true;
          callerType = 'school';
          callerSchoolId = studentData.schoolId;
        }
      }

      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { studentId, newPassword: studentNewPassword } = studentData || {};

      if (!studentId || !studentNewPassword) {
        return new Response(
          JSON.stringify({ error: "Student ID and new password required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (studentNewPassword.length < 6) {
        return new Response(
          JSON.stringify({ error: "Password must be at least 6 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get the student's user_id
      const { data: student, error: studentError } = await supabase
        .from("students")
        .select("id, user_id, school_id")
        .eq("id", studentId)
        .maybeSingle();

      if (studentError || !student) {
        return new Response(
          JSON.stringify({ error: "Student not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If caller is school, verify student belongs to their school
      if (callerType === 'school' && student.school_id !== callerSchoolId) {
        return new Response(
          JSON.stringify({ error: "Student does not belong to your school" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use Supabase Admin API to update the user's password
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        student.user_id,
        { password: studentNewPassword }
      );

      if (updateError) {
        console.error("Update student password error:", updateError);
        return new Response(
          JSON.stringify({ error: updateError.message || "Failed to update password" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Student password updated successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "create_admin") {
      // Special action to bootstrap admin (only works if no admins exist)
      const adminId = identifier;
      const adminPassword = password;
      // Check if any admin already exists
      const { data: existingAdmins } = await supabase
        .from("admins")
        .select("id")
        .limit(1);
      
      // Allow creation if no admins exist or if secret key matches
      const BOOTSTRAP_KEY = Deno.env.get("ADMIN_BOOTSTRAP_KEY") || "edu_improvement_bootstrap_2024";
      const isBootstrap = !existingAdmins || existingAdmins.length === 0;
      const hasValidKey = secretKey === BOOTSTRAP_KEY;
      
      if (!isBootstrap && !hasValidKey) {
        return new Response(
          JSON.stringify({ error: "Admin creation not allowed" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const hashedPassword = await hashPassword(adminPassword);

      const { data: newAdmin, error } = await supabase
        .from("admins")
        .insert({
          admin_id: adminId,
          password_hash: hashedPassword,
          name: adminName || "Super Admin",
          role: "super_admin",
          password_reset_required: false,
          password_updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("Create admin error:", error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          admin: { id: newAdmin.id, adminId: newAdmin.admin_id, name: newAdmin.name }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Auth error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
