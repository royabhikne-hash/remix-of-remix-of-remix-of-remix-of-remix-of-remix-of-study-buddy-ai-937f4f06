-- Create achievements table for badges
CREATE TABLE public.achievements (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    achievement_type text NOT NULL,
    achievement_title text NOT NULL,
    achievement_description text,
    badge_icon text NOT NULL DEFAULT 'trophy',
    achieved_at timestamp with time zone NOT NULL DEFAULT now(),
    week_start date,
    ranking_type text, -- 'school', 'district', 'global'
    rank_achieved integer,
    is_read boolean NOT NULL DEFAULT false,
    UNIQUE(student_id, achievement_type, week_start)
);

-- Enable RLS on achievements
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- Students can view their own achievements
CREATE POLICY "Students can view own achievements"
ON public.achievements FOR SELECT
USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

-- Students can mark their achievements as read
CREATE POLICY "Students can update own achievements"
ON public.achievements FOR UPDATE
USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

-- Create rank_notifications table for real-time rank change alerts
CREATE TABLE public.rank_notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    notification_type text NOT NULL, -- 'rank_improved', 'entered_top_10', 'top_3'
    message text NOT NULL,
    old_rank integer,
    new_rank integer,
    ranking_type text NOT NULL, -- 'school', 'district'
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    is_read boolean NOT NULL DEFAULT false
);

-- Enable RLS on rank_notifications
ALTER TABLE public.rank_notifications ENABLE ROW LEVEL SECURITY;

-- Students can view their own notifications
CREATE POLICY "Students can view own notifications"
ON public.rank_notifications FOR SELECT
USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

-- Students can mark notifications as read
CREATE POLICY "Students can update own notifications"
ON public.rank_notifications FOR UPDATE
USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

-- Create indexes for efficient queries
CREATE INDEX idx_achievements_student ON public.achievements(student_id);
CREATE INDEX idx_achievements_week ON public.achievements(week_start);
CREATE INDEX idx_notifications_student ON public.rank_notifications(student_id);
CREATE INDEX idx_notifications_unread ON public.rank_notifications(student_id, is_read);