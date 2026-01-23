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

// Calculate rankings for a list of students with sessions
function calculateStudentRankings(studentsWithSessions: any[], filterDistrict?: string) {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  
  // Filter by district if specified
  const studentsToRank = filterDistrict 
    ? studentsWithSessions.filter((s: any) => s.district === filterDistrict)
    : studentsWithSessions;
  
  const rankings = studentsToRank.map((student: any) => {
    const sessions = student.study_sessions || [];
    
    const improvementScores = sessions
      .map((s: any) => s.improvement_score || 50)
      .slice(0, 10);
    const avgImprovement = improvementScores.length > 0
      ? Math.round(improvementScores.reduce((a: number, b: number) => a + b, 0) / improvementScores.length)
      : 0;
    
    const todaySessions = sessions.filter((s: any) => 
      new Date(s.created_at) >= startOfToday
    );
    const dailyStudyTime = todaySessions.reduce((acc: number, s: any) => acc + (s.time_spent || 0), 0);
    
    const weekSessions = sessions.filter((s: any) => 
      new Date(s.created_at) >= startOfWeek
    );
    const uniqueDays = new Set(
      weekSessions.map((s: any) => new Date(s.created_at).toDateString())
    ).size;
    
    const improvementPoints = avgImprovement * 0.4;
    const dailyPoints = Math.min(dailyStudyTime, 120) * 0.25;
    const consistencyPoints = (uniqueDays / 7) * 30;
    const totalScore = Math.round(improvementPoints + dailyPoints + consistencyPoints);
    
    return {
      id: student.id,
      name: student.full_name,
      photo: student.photo_url,
      class: student.class,
      district: student.district,
      schoolId: student.school_id,
      schoolName: student.schools?.name || 'No School',
      improvementScore: avgImprovement,
      dailyStudyTime,
      weeklyStudyDays: uniqueDays,
      totalScore,
      rank: 0
    };
  });
  
  // Sort by total score descending and assign ranks
  rankings.sort((a: any, b: any) => b.totalScore - a.totalScore);
  rankings.forEach((student: any, index: number) => {
    student.rank = index + 1;
  });
  
  return rankings;
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

    // Handle student ranking request (for student dashboard)
    if (action === 'get_student_rankings') {
      if (!student_id) {
        return new Response(
          JSON.stringify({ error: 'Student ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get the student's info including district and school
      const { data: studentData } = await supabaseAdmin
        .from('students')
        .select('*, schools(name)')
        .eq('id', student_id)
        .maybeSingle();

      if (!studentData || !studentData.is_approved) {
        return new Response(
          JSON.stringify({ error: 'Student not found or not approved' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch ALL approved students from the same school and district for rankings
      const { data: allSchoolStudents } = await supabaseAdmin
        .from('students')
        .select('*, schools(name)')
        .eq('school_id', studentData.school_id)
        .eq('is_approved', true)
        .eq('is_banned', false);

      const { data: allDistrictStudents } = await supabaseAdmin
        .from('students')
        .select('*, schools(name)')
        .eq('district', studentData.district)
        .eq('is_approved', true)
        .eq('is_banned', false);

      // Fetch sessions for all students
      const fetchSessionsForStudents = async (students: any[]) => {
        return Promise.all(
          (students || []).map(async (student) => {
            const { data: sessions } = await supabaseAdmin
              .from('study_sessions')
              .select('*, quiz_attempts(accuracy_percentage)')
              .eq('student_id', student.id)
              .order('created_at', { ascending: false })
              .limit(10);

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
      };

      const schoolStudentsWithSessions = await fetchSessionsForStudents(allSchoolStudents || []);
      const districtStudentsWithSessions = await fetchSessionsForStudents(allDistrictStudents || []);

      // Calculate rankings
      const schoolRankings = calculateStudentRankings(schoolStudentsWithSessions);
      const districtRankings = calculateStudentRankings(districtStudentsWithSessions);

      // Find the current student's position in each
      const studentSchoolRank = schoolRankings.find((r: any) => r.id === student_id);
      const studentDistrictRank = districtRankings.find((r: any) => r.id === student_id);

      // Get ranking history for the student
      const { data: rankingHistory } = await supabaseAdmin
        .from('ranking_history')
        .select('*')
        .eq('student_id', student_id)
        .order('week_start', { ascending: false })
        .limit(10);

      return new Response(
        JSON.stringify({
          student: studentData,
          mySchoolRank: studentSchoolRank || null,
          myDistrictRank: studentDistrictRank || null,
          schoolRankings: schoolRankings.slice(0, 10),
          districtRankings: districtRankings.slice(0, 10),
          totalSchoolStudents: schoolRankings.length,
          totalDistrictStudents: districtRankings.length,
          rankingHistory: rankingHistory || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        .select('id, name, is_banned, fee_paid, district')
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

      // Fetch all students from the same district for district rankings
      const { data: districtStudents } = await supabaseAdmin
        .from('students')
        .select('*, schools(name)')
        .eq('district', school.district)
        .eq('is_approved', true)
        .eq('is_banned', false);

      // Fetch study sessions with quiz attempts for each student
      const studentsWithSessions = await Promise.all(
        (students || []).map(async (student) => {
          const { data: sessions } = await supabaseAdmin
            .from('study_sessions')
            .select('*, quiz_attempts(accuracy_percentage)')
            .eq('student_id', student.id)
            .order('created_at', { ascending: false })
            .limit(10);

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

      // Fetch sessions for district students
      const districtStudentsWithSessions = await Promise.all(
        (districtStudents || []).map(async (student) => {
          const { data: sessions } = await supabaseAdmin
            .from('study_sessions')
            .select('*, quiz_attempts(accuracy_percentage)')
            .eq('student_id', student.id)
            .order('created_at', { ascending: false })
            .limit(10);

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

      // Calculate school rankings (only approved students from this school)
      const approvedSchoolStudents = studentsWithSessions.filter((s: any) => s.is_approved);
      const schoolRankings = calculateStudentRankings(approvedSchoolStudents);

      // Calculate district rankings (all approved students from same district)
      const districtRankings = calculateStudentRankings(districtStudentsWithSessions);

      return new Response(
        JSON.stringify({ 
          students: studentsWithSessions, 
          school, 
          rankings: schoolRankings,
          districtRankings,
          schoolDistrict: school.district
        }),
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

      // Fetch all students with school info and study sessions for rankings
      const { data: students, error: studentsError } = await supabaseAdmin
        .from('students')
        .select('*, schools(name, district)')
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

      // Fetch study sessions for all students to calculate rankings
      const studentsWithSessions = await Promise.all(
        (students || []).map(async (student) => {
          const { data: sessions } = await supabaseAdmin
            .from('study_sessions')
            .select('*, quiz_attempts(accuracy_percentage)')
            .eq('student_id', student.id)
            .order('created_at', { ascending: false })
            .limit(10);

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

      // Calculate global rankings for all approved students
      const approvedStudentsForRanking = studentsWithSessions.filter((s: any) => s.is_approved && !s.is_banned);
      const globalRankings = calculateStudentRankings(approvedStudentsForRanking);

      // Get unique districts and create district-wise rankings
      const districts = [...new Set(approvedStudentsForRanking.map((s: any) => s.district).filter(Boolean))];
      const districtRankings: Record<string, any[]> = {};
      
      for (const district of districts) {
        districtRankings[district] = calculateStudentRankings(approvedStudentsForRanking, district);
      }

      return new Response(
        JSON.stringify({ 
          students: students || [], 
          schools: schools || [], 
          rankings: globalRankings,
          districtRankings,
          districts
        }),
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