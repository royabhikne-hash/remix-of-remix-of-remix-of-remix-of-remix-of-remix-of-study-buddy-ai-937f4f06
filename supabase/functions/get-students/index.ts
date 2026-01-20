import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validate session token from database
async function validateSessionToken(
  supabase: any,
  token: string,
  expectedUserType?: 'admin' | 'school',
  expectedUserId?: string
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
  
  if (expectedUserId && data.user_id !== expectedUserId) {
    return { valid: false };
  }
  
  return { valid: true, userId: data.user_id, userType: data.user_type };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, session_token, user_type, school_id, student_id, student_class } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Handle student report data request
    if (action === 'get_student_report') {
      let isAuthorized = false;
      let authorizedSchoolId: string | null = null;
      
      if (user_type === 'school' && school_id && session_token) {
        const validation = await validateSessionToken(supabaseAdmin, session_token, 'school', school_id);
        isAuthorized = validation.valid;
        if (isAuthorized) authorizedSchoolId = school_id;
      } else if (user_type === 'admin' && session_token) {
        const validation = await validateSessionToken(supabaseAdmin, session_token, 'admin');
        isAuthorized = validation.valid;
      }

      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Load student info with school
      const { data: studentData } = await supabaseAdmin
        .from('students')
        .select('*, schools(*)')
        .eq('id', student_id)
        .maybeSingle();

      // For school users, verify the student belongs to their school
      if (user_type === 'school' && studentData?.school_id !== authorizedSchoolId) {
        return new Response(
          JSON.stringify({ error: 'Student does not belong to your school' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Load study sessions from last 7 days with quiz attempts for accurate scoring
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: sessionsData } = await supabaseAdmin
        .from('study_sessions')
        .select('*, quiz_attempts(accuracy_percentage)')
        .eq('student_id', student_id)
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false });

      const { data: quizzesData } = await supabaseAdmin
        .from('quiz_attempts')
        .select('*')
        .eq('student_id', student_id)
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false });
      
      // Enhance sessions with quiz accuracy as primary score
      const enhancedSessions = (sessionsData || []).map((session: any) => {
        const quizAttempts = session.quiz_attempts as { accuracy_percentage: number | null }[] | null;
        const quizScore = (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null)
          ? quizAttempts[0].accuracy_percentage
          : null;
        
        return {
          ...session,
          // Use quiz score if available, otherwise keep original improvement_score
          improvement_score: quizScore !== null ? quizScore : session.improvement_score,
        };
      });

      // Load class averages for comparison
      let classAverages = null;
      if (student_class) {
        const { data: classStudents } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('class', student_class);

        if (classStudents && classStudents.length > 0) {
          const studentIds = classStudents.map((s: { id: string }) => s.id);

          const { data: classSessions } = await supabaseAdmin
            .from('study_sessions')
            .select('*')
            .in('student_id', studentIds)
            .gte('created_at', weekAgo.toISOString());

          const { data: classQuizzes } = await supabaseAdmin
            .from('quiz_attempts')
            .select('*')
            .in('student_id', studentIds)
            .gte('created_at', weekAgo.toISOString());

          const studentCount = classStudents.length;
          const totalSessions = classSessions?.length || 0;
          const totalQuizzes = classQuizzes?.length || 0;
          const totalTimeSpent = classSessions?.reduce((acc: number, s: { time_spent?: number }) => acc + (s.time_spent || 0), 0) || 0;
          const totalAccuracy = classQuizzes?.reduce((acc: number, q: { accuracy_percentage?: number }) => acc + (q.accuracy_percentage || 0), 0) || 0;
          const totalImprovementScore = classSessions?.reduce((acc: number, s: { improvement_score?: number }) => acc + (s.improvement_score || 50), 0) || 0;

          classAverages = {
            avgSessions: Math.round((totalSessions / studentCount) * 10) / 10,
            avgTimeSpent: Math.round(totalTimeSpent / studentCount),
            avgAccuracy: totalQuizzes > 0 ? Math.round(totalAccuracy / totalQuizzes) : 0,
            avgQuizzes: Math.round((totalQuizzes / studentCount) * 10) / 10,
            avgImprovementScore: totalSessions > 0 ? Math.round(totalImprovementScore / totalSessions) : 50,
          };
        }
      }

      return new Response(
        JSON.stringify({
          student: studentData,
          sessions: enhancedSessions,
          quizzes: quizzesData || [],
          classAverages,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate session token for list operations
    if (!session_token) {
      return new Response(
        JSON.stringify({ error: 'Session token required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (user_type === 'school') {
      // Validate school session token
      const validation = await validateSessionToken(supabaseAdmin, session_token, 'school', school_id);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired school session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify school exists and is not banned
      const { data: school, error } = await supabaseAdmin
        .from('schools')
        .select('id, name, is_banned, fee_paid')
        .eq('id', school_id)
        .maybeSingle();

      if (error || !school) {
        return new Response(
          JSON.stringify({ error: 'School not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (school.is_banned) {
        return new Response(
          JSON.stringify({ error: 'School is banned' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch students for this school
      const { data: students, error: studentsError } = await supabaseAdmin
        .from('students')
        .select('*')
        .eq('school_id', school_id)
        .eq('is_banned', false)
        .order('created_at', { ascending: false });

      if (studentsError) {
        console.error('Error fetching students:', studentsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch students' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch study sessions with quiz attempts for each student to get accurate scores
      const studentsWithSessions = await Promise.all(
        (students || []).map(async (student) => {
          const { data: sessions } = await supabaseAdmin
            .from('study_sessions')
            .select('*, quiz_attempts(accuracy_percentage)')
            .eq('student_id', student.id)
            .order('created_at', { ascending: false })
            .limit(10);

          // Enhance sessions with quiz accuracy as primary score
          const enhancedSessions = (sessions || []).map((session: any) => {
            const quizAttempts = session.quiz_attempts as { accuracy_percentage: number | null }[] | null;
            const quizScore = (quizAttempts && quizAttempts.length > 0 && quizAttempts[0].accuracy_percentage !== null)
              ? quizAttempts[0].accuracy_percentage
              : null;
            
            return {
              ...session,
              improvement_score: quizScore !== null ? quizScore : session.improvement_score,
            };
          });

          return {
            ...student,
            study_sessions: enhancedSessions
          };
        })
      );

      return new Response(
        JSON.stringify({ students: studentsWithSessions, school }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (user_type === 'admin') {
      // Validate admin session token
      const validation = await validateSessionToken(supabaseAdmin, session_token, 'admin');
      if (!validation.valid) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired admin session' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch all students with school info
      const { data: students, error: studentsError } = await supabaseAdmin
        .from('students')
        .select('*, schools(name)')
        .order('created_at', { ascending: false });

      if (studentsError) {
        console.error('Error fetching students:', studentsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch students' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch all schools
      const { data: schools, error: schoolsError } = await supabaseAdmin
        .from('schools')
        .select('*')
        .order('created_at', { ascending: false });

      if (schoolsError) {
        console.error('Error fetching schools:', schoolsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch schools' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ students: students || [], schools: schools || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid user type' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
