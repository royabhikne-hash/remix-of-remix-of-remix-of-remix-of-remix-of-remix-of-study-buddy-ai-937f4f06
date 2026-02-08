import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Calendar,
  Crown,
  Clock,
  ChevronRight,
} from 'lucide-react';

interface StudentWithSubscription {
  id: string;
  full_name: string;
  class: string;
  photo_url: string | null;
  subscriptions: {
    plan: 'basic' | 'pro';
    tts_used: number;
    tts_limit: number;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
  }[];
}

interface ExpiringSubscriptionsWidgetProps {
  students: StudentWithSubscription[];
  daysThreshold?: number;
  onViewAll?: () => void;
}

export const ExpiringSubscriptionsWidget = ({
  students,
  daysThreshold = 7,
  onViewAll,
}: ExpiringSubscriptionsWidgetProps) => {
  const expiringStudents = useMemo(() => {
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(now.getDate() + daysThreshold);

    return students
      .filter((student) => {
        const subscription = student.subscriptions?.[0];
        if (!subscription || subscription.plan !== 'pro' || !subscription.end_date) {
          return false;
        }
        const endDate = new Date(subscription.end_date);
        return endDate > now && endDate <= thresholdDate;
      })
      .map((student) => {
        const subscription = student.subscriptions[0];
        const endDate = new Date(subscription.end_date!);
        const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          ...student,
          daysLeft,
          endDate,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [students, daysThreshold]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
  };

  const getUrgencyColor = (daysLeft: number) => {
    if (daysLeft <= 1) return 'text-destructive bg-destructive/10 border-destructive/30';
    if (daysLeft <= 3) return 'text-warning bg-warning/10 border-warning/30';
    return 'text-primary bg-primary/10 border-primary/30';
  };

  const getUrgencyBadge = (daysLeft: number): { text: string; variant: 'destructive' | 'secondary' | 'outline' } => {
    if (daysLeft <= 1) return { text: 'Tomorrow!', variant: 'destructive' };
    if (daysLeft <= 3) return { text: `${daysLeft} days`, variant: 'secondary' };
    return { text: `${daysLeft} days`, variant: 'outline' };
  };

  if (expiringStudents.length === 0) {
    return (
      <div className="edu-card p-4 border-dashed border-2 border-muted">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium text-foreground">No Expiring Subscriptions</p>
            <p className="text-sm">No Pro plans expiring in the next {daysThreshold} days</p>
          </div>
        </div>
      </div>
    );
  }

  const urgentCount = expiringStudents.filter(s => s.daysLeft <= 1).length;
  const soonCount = expiringStudents.filter(s => s.daysLeft > 1 && s.daysLeft <= 3).length;

  return (
    <div className="edu-card overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-warning/10 border-b border-warning/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-warning/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Expiring Pro Plans</h3>
              <p className="text-xs text-muted-foreground">Next {daysThreshold} days</p>
            </div>
          </div>
          <Badge variant="secondary" className="bg-warning/20 text-warning border-warning/30">
            {expiringStudents.length} {expiringStudents.length === 1 ? 'student' : 'students'}
          </Badge>
        </div>
      </div>

      {/* List */}
      <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
        {expiringStudents.slice(0, 5).map((student) => {
          const urgency = getUrgencyBadge(student.daysLeft);
          const urgencyColor = getUrgencyColor(student.daysLeft);
          
          return (
            <div 
              key={student.id} 
              className={`p-3 hover:bg-muted/30 transition-colors ${student.daysLeft <= 1 ? 'bg-destructive/5' : ''}`}
            >
              <div className="flex items-center gap-3">
                {/* Avatar */}
                {student.photo_url ? (
                  <img
                    src={student.photo_url}
                    alt={student.full_name}
                    className={`w-10 h-10 rounded-full object-cover border-2 ${urgencyColor}`}
                  />
                ) : (
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${urgencyColor}`}>
                    {student.full_name.charAt(0)}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{student.full_name}</p>
                    <Crown className="w-3.5 h-3.5 text-warning flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Class {student.class}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Expires {formatDate(student.endDate)}
                    </span>
                  </div>
                </div>

                {/* Days Left Badge */}
                <Badge 
                  variant={urgency.variant}
                  className={student.daysLeft <= 1 ? 'animate-pulse' : ''}
                >
                  {urgency.text}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer - Show if more than 5 */}
      {expiringStudents.length > 5 && (
        <div className="p-3 border-t border-border bg-muted/20">
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={onViewAll}
          >
            View all {expiringStudents.length} expiring subscriptions
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Summary Stats */}
      {(urgentCount > 0 || soonCount > 0) && (
        <div className="p-3 border-t border-border bg-secondary/30">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              {urgentCount > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                  {urgentCount} expiring tomorrow
                </span>
              )}
              {soonCount > 0 && (
                <span className="flex items-center gap-1 text-warning">
                  <span className="w-2 h-2 rounded-full bg-warning" />
                  {soonCount} within 3 days
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpiringSubscriptionsWidget;
