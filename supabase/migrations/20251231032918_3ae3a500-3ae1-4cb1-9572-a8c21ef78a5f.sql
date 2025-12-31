-- Add rejection_reason to students table
ALTER TABLE public.students ADD COLUMN rejection_reason text;
ALTER TABLE public.students ADD COLUMN is_banned boolean DEFAULT false;

-- Add is_banned and fee_paid to schools table
ALTER TABLE public.schools ADD COLUMN is_banned boolean DEFAULT false;
ALTER TABLE public.schools ADD COLUMN fee_paid boolean DEFAULT true;
ALTER TABLE public.schools ADD COLUMN email text;
ALTER TABLE public.schools ADD COLUMN contact_whatsapp text;

-- Create index for better query performance
CREATE INDEX idx_students_banned ON public.students(is_banned);
CREATE INDEX idx_schools_banned ON public.schools(is_banned);
CREATE INDEX idx_schools_fee_paid ON public.schools(fee_paid);

-- Update existing schools to have fee_paid = true
UPDATE public.schools SET fee_paid = true WHERE fee_paid IS NULL;
UPDATE public.students SET is_banned = false WHERE is_banned IS NULL;
UPDATE public.schools SET is_banned = false WHERE is_banned IS NULL;