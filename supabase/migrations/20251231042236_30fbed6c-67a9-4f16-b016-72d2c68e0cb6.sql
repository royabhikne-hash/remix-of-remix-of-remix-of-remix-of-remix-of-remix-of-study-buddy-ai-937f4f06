-- Enable realtime for students table to track approval status changes
ALTER PUBLICATION supabase_realtime ADD TABLE public.students;