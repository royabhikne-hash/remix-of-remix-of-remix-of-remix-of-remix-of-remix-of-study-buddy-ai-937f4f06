-- Create ranking_history table for weekly ranking snapshots
CREATE TABLE public.ranking_history (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    week_start date NOT NULL,
    week_end date NOT NULL,
    school_rank integer,
    district_rank integer,
    global_rank integer,
    total_score integer NOT NULL DEFAULT 0,
    improvement_score integer NOT NULL DEFAULT 0,
    daily_study_time integer NOT NULL DEFAULT 0,
    weekly_study_days integer NOT NULL DEFAULT 0,
    district text,
    school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(student_id, week_start)
);

-- Enable RLS on ranking_history
ALTER TABLE public.ranking_history ENABLE ROW LEVEL SECURITY;

-- Students can view their own ranking history
CREATE POLICY "Students can view own ranking history"
ON public.ranking_history FOR SELECT
USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

-- Create index for efficient queries
CREATE INDEX idx_ranking_history_student ON public.ranking_history(student_id);
CREATE INDEX idx_ranking_history_week ON public.ranking_history(week_start);
CREATE INDEX idx_ranking_history_district ON public.ranking_history(district, week_start);
CREATE INDEX idx_ranking_history_school ON public.ranking_history(school_id, week_start);

-- Add district column to students table if needed for faster queries
-- Already exists in students table